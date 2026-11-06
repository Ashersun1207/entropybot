#!/usr/bin/env python3
"""Run the consent-aware synthetic acceptance fixture; never open a real profile."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    fixture = Path(__file__).resolve().parents[2] / 'electron/credential-namespace-migration-acceptance-fixture.py'
    runpy.run_path(str(fixture), run_name='__main__')
