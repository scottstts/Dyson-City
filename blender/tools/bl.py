#!/opt/homebrew/bin/python3
"""Send Python to the running Blender (blender-mcp add-on socket, port 9876).

Usage:
  bl.py -c "print(1)"         run inline code
  bl.py file.py [file2.py]    run files in order (each in a fresh namespace)
  bl.py -e "expr"             shorthand: print(repr(expr))
  bl.py -b mod.fn:args ...    reload blender/build and run builders (see blender/run.py)
"""
import json
import socket
import sys

HOST, PORT = "127.0.0.1", 9876


def run(code: str, timeout: float = 600.0) -> dict:
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    buf = b""
    while True:
        d = s.recv(1 << 20)
        if not d:
            break
        buf += d
        try:
            out = json.loads(buf)
            break
        except json.JSONDecodeError:
            continue
    s.close()
    return json.loads(buf)


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "-c":
        codes = [args[1]]
    elif args[0] == "-b":
        targets = ", ".join(repr(a) for a in args[1:])
        codes = ["import sys, traceback\n"
                 "sys.path.insert(0, '/Users/scott/Documents/Projects/Node/dysonCity/blender')\n"
                 "import run, importlib\nimportlib.reload(run)\n"
                 f"try:\n    run.go({targets})\nexcept Exception:\n    print(traceback.format_exc())\n"]
    elif args[0] == "-e":
        codes = [f"print(repr({args[1]}))"]
    else:
        codes = [open(p).read() for p in args]
    rc = 0
    for code in codes:
        r = run(code)
        if r.get("status") != "success":
            print("ERROR:", r.get("message", r))
            rc = 1
            break
        res = r.get("result", {})
        print(res.get("result", res) if isinstance(res, dict) else res, end="")
    return rc


if __name__ == "__main__":
    sys.exit(main())
