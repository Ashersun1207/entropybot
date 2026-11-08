#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True

from execution import run
from verification import verify


def main():
    parser = argparse.ArgumentParser(description='Local source-bound verification receipts; not a release authority')
    parser.add_argument('action', choices=['run','verify'])
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--registry', type=Path, default=Path(__file__).with_name('checks.json'))
    parser.add_argument('--check')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    try:
        root = args.root.resolve(strict=True)
        if args.action=='run':
            if not args.check or not args.out:
                parser.error('run requires --check and --out')
            result, accepted = run(root,args.registry,args.check,args.out)
        else:
            if not args.receipt:
                parser.error('verify requires --receipt')
            result, accepted = verify(root,args.registry,args.receipt)
    except Exception as error:
        result = {'status':'error','accepted':False,'errorType':type(error).__name__}
        accepted = False
    print(json.dumps(result,sort_keys=True))
    return 0 if accepted else 1


if __name__=='__main__':
    sys.exit(main())
