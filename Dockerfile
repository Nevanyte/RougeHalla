# RougeHalla on a server of your own (the optional alternative to `npm run playtest` from a laptop).
#   docker build -t rougehalla .
#   docker run -d --name rougehalla -p 2567:2567 -v rougehalla-data:/data -e PLAYTEST_PASSCODE=pick-something rougehalla
# One container serves the page, the API and the websocket on one port. Put TLS in front of it (Caddy, nginx, a
# Cloudflare tunnel): browsers will not open a websocket from an https page to plain ws. Profiles live in the /data volume
# (/data/profiles.json). `docker stop` sends SIGTERM, which the server answers by saving the profiles and exiting.

# Node 24 is an LTS line inside the range the toolchain declares (vitest: ^22.12 || ^24 || >=26; npm warns on 23 and 25).
FROM node:24-bookworm-slim
# Changing this label gives the image a new digest without touching the game: Cloudflare's image preparation for one digest
# can stick at "pending" (2026-11-03, sha256:1ac845e...), and every redeploy of that digest waits on the same stuck job.
LABEL com.roguehalla.image-bump="2026-11-03"

WORKDIR /app

# The dependency layer first: it only changes with a package.json or the lockfile.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# Build tools are installed here; the server and map worker are compiled before this image starts.
RUN npm ci

COPY . .
# VITE_SERVER_URL stays unset: the page talks to the origin it was served from.
RUN npm run build

# Profiles outlive the container. The node user (uid 1000) owns the volume.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

ENV NODE_ENV=production \
    RAID_PORT=2567 \
    CLIENT_DIR=/app/packages/client/dist \
    STASH_FILE=/data/profiles.json
EXPOSE 2567
USER node

# The profile file's single-writer lock holds a process id, and in a container that is always 1: after a hard kill the
# next start would read its own id as a live holder and refuse. One container owns the volume, so a leftover lock is
# stale; `exec` keeps node as PID 1, so docker's SIGTERM reaches the server's own shutdown handler.
CMD ["sh", "-c", "rm -f \"$STASH_FILE.lock\" && exec node --max-semi-space-size=32 packages/server/dist/index.mjs"]
