"""Load a harness Python script as a module by path (several have hyphens or live outside a package)."""
import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # keep __pycache__ out of the repo


def load(rel, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(REPO, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
