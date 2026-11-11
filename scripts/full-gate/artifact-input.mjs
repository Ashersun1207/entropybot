import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { insist } from "./core.mjs";

export function regularBytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    insist(stat.isFile() && stat.size <= 33554432, "artifact is not a bounded regular file");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    insist(offset === stat.size, "artifact size changed during read");
    return bytes.subarray(0, offset);
  } finally { closeSync(fd); }
}
