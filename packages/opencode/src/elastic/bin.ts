import p from "path"

export namespace ElasticBin {
  export function resolve() {
    const ext = process.platform === "win32" ? ".exe" : ""
    return p.join(p.dirname(process.execPath), "elastic" + ext)
  }
}
