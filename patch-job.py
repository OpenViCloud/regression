#!/usr/bin/env python3
"""Points the `specs` volume of a Job at a ConfigMap of its own, so two jobs started together read two spec sets.

The runner's CronJob mounts one ConfigMap by a fixed name; `run-module.sh` creates the job from the CronJob with
`--dry-run=client -o json`, pipes it through here, and creates the result.

Usage:  kubectl create job <name> --from=cronjob/<c> --dry-run=client -o json | python3 patch-job.py <configmap> | kubectl create -f -
"""
import copy
import json
import sys

VOLUME = "specs"


class PatchError(Exception):
    pass


def patch(job, config_map):
    out = copy.deepcopy(job)
    volumes = out["spec"]["template"]["spec"].get("volumes", [])
    found = [v for v in volumes if v.get("name") == VOLUME]
    if len(found) != 1:
        raise PatchError(f"expected one volume named {VOLUME!r}, found {len(found)}")
    if "configMap" not in found[0]:
        raise PatchError(f"volume {VOLUME!r} is not a ConfigMap volume")
    found[0]["configMap"]["name"] = config_map
    return out


def main(argv):
    if len(argv) != 2:
        print("Usage: patch-job.py <configmap>  (Job JSON on stdin, patched Job JSON on stdout)", file=sys.stderr)
        return 2
    try:
        patched = patch(json.load(sys.stdin), argv[1])
    except (PatchError, KeyError, json.JSONDecodeError) as error:
        print(f"patch-job.py: {error}", file=sys.stderr)
        return 1
    json.dump(patched, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
