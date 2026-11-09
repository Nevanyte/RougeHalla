# Passing candidate before explicit OFF lifetime receipt

The complete actual caller capture, five OFF/ON public-trace controls and byte-exact check passed. The earlier canonical bytes are preserved losslessly in source.json.gz (gzip mtime0): uncompressed30,631,979 bytes, SHA-25694c90e451b23a4a53149ce67bc091e8f6f6ff4092751f07cbea3e211cc14c1ad. Decompression was compared to the original bytes.

Review found a receipt omission: the runner measured/asserted OFF inspector lifetime cleanup internally, but the outer artifact retained OFF summary/trace/provenance without retaining the complete measured OFF lifetime object. The final capture adds that object explicitly. No source runner, Brain, World, observer, schedule, input, output or comparison behavior changes. The old passing log remains historical, not the final seal.
