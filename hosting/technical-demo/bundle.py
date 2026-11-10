#!/usr/bin/env python3
"""Build the local, nondeployable plain-tar input for the technical demo host."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

MAX_BUNDLE = 160 * 1024 * 1024
MAX_EXTRACT = 400 * 1024 * 1024
MAX_MEMBERS = 10_000
MAX_MANIFEST = 2 * 1024 * 1024
CHUNK = 1024 * 1024


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def _safe_member(name):
    path = PurePosixPath(name)
    require(name == str(path) and not path.is_absolute(), f"unsafe member path: {name!r}")
    require(all(part not in ("", ".", "..") for part in path.parts), f"unsafe member path: {name!r}")
    require(re.fullmatch(r"[A-Za-z0-9_./-]+", name) is not None, f"unsafe member characters: {name!r}")
    require(name in ("rh-server", "source-map.json") or name.startswith("web/"),
            f"member is outside host allowlist: {name!r}")
    require(_ustar_fits(name), f"USTAR path too long: {name!r}")
    return name


def _ustar_fits(name):
    if len(name.encode("ascii")) <= 100:
        return True
    for index, char in enumerate(name):
        if char == "/" and len(name[:index].encode("ascii")) <= 155 and len(name[index + 1:].encode("ascii")) <= 100:
            return True
    return False


def _open_regular(path, *, executable=False):
    try:
        before = path.lstat()
    except OSError as exc:
        raise ValueError(f"cannot stat input {path}: {exc.strerror}") from exc
    require(stat.S_ISREG(before.st_mode) and not path.is_symlink(), f"input must be a regular non-symlink file: {path}")
    require(before.st_nlink == 1, f"hard-linked input is refused: {path}")
    if executable:
        require(before.st_mode & 0o111, f"server binary is not executable: {path}")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError(f"cannot open input {path}: {exc.strerror}") from exc
    try:
        opened = os.fstat(fd)
        require(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1, f"input changed type while opening: {path}")
        require(_stat_key(before) == _stat_key(opened), f"input changed while opening: {path}")
        return os.fdopen(fd, "rb"), opened
    except BaseException:
        os.close(fd)
        raise


def _stat_key(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _hash_input(path, *, executable=False):
    with _open_regular(path, executable=executable)[0] as stream:
        before = os.fstat(stream.fileno())
        size = before.st_size
        digest = hashlib.sha256()
        first = bytearray()
        while True:
            block = stream.read(CHUNK)
            if not block:
                break
            if len(first) < 20:
                first.extend(block[:20 - len(first)])
            digest.update(block)
        after = os.fstat(stream.fileno())
        require(_stat_key(before) == _stat_key(after), f"input changed while hashing: {path}")
    require(size >= 0, f"negative input size: {path}")
    return {"path": path, "bytes": size, "sha256": digest.hexdigest(), "stat": _stat_key(after),
            "elf_header": bytes(first) if executable else None}


class _HashingReader:
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()
        self.bytes = 0

    def read(self, size=-1):
        block = self.stream.read(size)
        self.digest.update(block)
        self.bytes += len(block)
        return block


def _web_files(web_root):
    try:
        root_info = web_root.lstat()
    except OSError as exc:
        raise ValueError(f"cannot stat Web directory {web_root}: {exc.strerror}") from exc
    require(stat.S_ISDIR(root_info.st_mode) and not web_root.is_symlink(),
            f"Web input must be a real directory: {web_root}")
    files = []
    def traversal_error(exc):
        raise ValueError(f"cannot traverse complete Web input {exc.filename}: {exc.strerror}") from exc

    for parent, dirs, names in os.walk(web_root, topdown=True, onerror=traversal_error, followlinks=False):
        parent_path = Path(parent)
        kept_dirs = []
        for name in sorted(dirs):
            path = parent_path / name
            info = path.lstat()
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
                    f"Web tree contains a symlink or special directory: {path}")
            _safe_member("web/" + path.relative_to(web_root).as_posix())
            kept_dirs.append(name)
        dirs[:] = kept_dirs
        for name in sorted(names):
            path = parent_path / name
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode),
                    f"Web tree contains a symlink or special file: {path}")
            rel = path.relative_to(web_root).as_posix()
            files.append((_safe_member("web/" + rel), path))
    files.sort(key=lambda pair: pair[0])
    require(any(name == "web/index.html" for name, _ in files), "Web input is missing web/index.html")
    return files


def _check_map(path):
    info = _hash_input(path)
    stream, opened = _open_regular(path)
    with stream:
        reader = _HashingReader(stream)
        try:
            value = json.load(reader, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f"source map must be finite UTF-8 JSON: {path}") from exc
        after = os.fstat(stream.fileno())
        require(reader.bytes == info["bytes"] and reader.digest.hexdigest() == info["sha256"],
                f"source map changed while validating: {path}")
        require(_stat_key(opened) == _stat_key(after), f"source map metadata changed while validating: {path}")
    require(type(value) is dict, "source map JSON root must be an object")
    return info


def _manifest_bytes(infos):
    rows = {name: info["sha256"] for name, info in sorted(infos.items())}
    data = (json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    require(len(data) <= MAX_MANIFEST, "bundle manifest exceeds 2 MiB")
    return data


def _tar_size(members):
    total = 10240  # USTAR end markers/padding written by tarfile.
    for _name, size in members:
        total += 512 + ((size + 511) // 512) * 512
    return total


def _metadata(name, size, mode):
    info = tarfile.TarInfo(name)
    info.size = size
    info.mode = mode
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.type = tarfile.REGTYPE
    return info


def _check_output_paths(output, receipt, inputs, web_root):
    output_real = output.resolve(strict=False)
    receipt_real = receipt.resolve(strict=False)
    web_real = web_root.resolve(strict=True)
    input_real = {path.resolve(strict=True) for path in inputs}
    require(output_real != receipt_real, "tar and receipt paths must differ")
    for path in (output, receipt):
        require(path.is_absolute(), f"output path must be absolute: {path}")
        require(path.parent.is_dir(), f"output parent directory must already exist: {path.parent}")
        require(not os.path.lexists(path), f"output already exists: {path}")
        real = path.resolve(strict=False)
        require(real != web_real and web_real not in real.parents,
                f"output must be outside the Web input tree: {path}")
        require(real not in input_real, f"output collides with an input: {path}")


def build_bundle(server, source_map, web, output, receipt):
    """Package explicit reviewed inputs; never execute the supplied binary or mutate inputs."""
    server = Path(server).absolute()
    source_map = Path(source_map).absolute()
    web = Path(web).absolute()
    output = Path(output).absolute()
    receipt = Path(receipt).absolute()
    require(server != source_map, "server and map paths must differ")
    require(not server.is_symlink() and not source_map.is_symlink(), "symlink input paths are refused")
    input_paths = {server, source_map}
    web_files = _web_files(web)
    input_paths.update(path for _, path in web_files)
    require(output not in input_paths and receipt not in input_paths, "output collides with an input")
    _check_output_paths(output, receipt, input_paths, web)

    server_info = _hash_input(server, executable=True)
    header = server_info["elf_header"]
    require(len(header) >= 20 and header[:6] == b"\x7fELF\x02\x01" and header[18:20] == b"\x3e\x00",
            "server must be a little-endian ELF64 x86-64 binary")
    map_info = _check_map(source_map)
    infos = {"rh-server": server_info, "source-map.json": map_info}
    for name, path in web_files:
        infos[name] = _hash_input(path)
    require(len(web_files) + 3 <= MAX_MEMBERS, "bundle exceeds 10,000 members")
    total_expanded = sum(info["bytes"] for info in infos.values())
    require(total_expanded <= MAX_EXTRACT, "bundle members exceed 400 MiB expanded")
    manifest = _manifest_bytes(infos)
    require(total_expanded + len(manifest) <= MAX_EXTRACT, "bundle members exceed 400 MiB expanded")
    all_members = [(name, info["bytes"]) for name, info in infos.items()]
    all_members.append(("bundle-manifest.json", len(manifest)))
    all_members.sort()
    require(_tar_size(all_members) <= MAX_BUNDLE, "plain tar would exceed 160 MiB download limit")
    infos["bundle-manifest.json"] = {"path": None, "bytes": len(manifest), "sha256": hashlib.sha256(manifest).hexdigest(), "stat": None}

    archive_hash = hashlib.sha256()
    try:
        with output.open("xb") as raw:
            with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for name, size in all_members:
                    if name == "bundle-manifest.json":
                        tar.addfile(_metadata(name, size, 0o644), _bytes_reader(manifest))
                        continue
                    info = infos[name]
                    path = info["path"]
                    file, opened = _open_regular(path, executable=(name == "rh-server"))
                    with file:
                        require(_stat_key(opened) == info["stat"], f"input changed before packaging: {path}")
                        reader = _HashingReader(file)
                        tar.addfile(_metadata(name, size, 0o755 if name == "rh-server" else 0o644), reader)
                        after = os.fstat(file.fileno())
                        require(reader.bytes == size and reader.digest.hexdigest() == info["sha256"],
                                f"input bytes changed during packaging: {path}")
                        require(_stat_key(opened) == _stat_key(after), f"input metadata changed during packaging: {path}")
            raw.flush()
            os.fsync(raw.fileno())
        final_web_files = _web_files(web)
        require(final_web_files == web_files, "Web input inventory changed during packaging")
        archive_bytes = output.stat().st_size
        require(0 < archive_bytes <= MAX_BUNDLE, "final tar exceeds 160 MiB download limit")
        with output.open("rb") as stream:
            while block := stream.read(CHUNK):
                archive_hash.update(block)
        result = {
            "format": "roguehalla-technical-demo-bundle-v1",
            "deployable": False,
            "archive": {"path": str(output), "bytes": archive_bytes, "sha256": archive_hash.hexdigest()},
            "manifest": {"member": "bundle-manifest.json", "bytes": len(manifest),
                         "sha256": hashlib.sha256(manifest).hexdigest()},
            "limits": {"maxArchiveBytes": MAX_BUNDLE, "maxExpandedBytes": MAX_EXTRACT, "maxMembers": MAX_MEMBERS},
            "members": [
                {"path": name, "bytes": infos[name]["bytes"], "sha256": infos[name]["sha256"],
                 "mode": "0755" if name == "rh-server" else "0644"}
                for name, _ in all_members
            ],
            "runtimeIdentity": "not measured; obtain protocol/content_hash from separate reviewed /info receipt",
        }
        payload = (json.dumps(result, sort_keys=True, indent=2) + "\n").encode("utf-8")
        with receipt.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        return result
    except BaseException:
        # A failed exclusive output is retained for diagnosis; callers must choose a new path.
        raise


def _bytes_reader(data):
    from io import BytesIO
    return BytesIO(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, help="reviewed Linux x86-64 server binary (not executed)")
    parser.add_argument("--map", required=True, help="already-extracted complete Source map JSON")
    parser.add_argument("--web", required=True, help="complete reviewed Unity Web output directory")
    parser.add_argument("--output", required=True, help="new absolute plain USTAR output path")
    parser.add_argument("--receipt", required=True, help="new absolute local receipt JSON path outside the archive")
    args = parser.parse_args(argv)
    result = build_bundle(args.server, args.map, args.web, args.output, args.receipt)
    print(json.dumps({"archive": result["archive"], "manifest": result["manifest"],
                      "members": len(result["members"]), "deployable": False}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError) as exc:
        raise SystemExit(f"bundle refused: {exc}")
