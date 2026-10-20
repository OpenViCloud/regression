"""Drop the info records of three chatty framework categories from an ASP.NET console log; keep everything else.

A record is its header line (`info: Category[id]`) plus the indented lines under it. warn/fail/crit records and every
category not listed are kept whole, so an error or a Titan log line is never lost.
"""
import re
import sys

NOISY = {
    "Microsoft.AspNetCore.Hosting.Diagnostics",
    "Microsoft.AspNetCore.Routing.EndpointMiddleware",
    "Microsoft.EntityFrameworkCore.Database.Command",
}
HEADER = re.compile(r"^(trce|dbug|info|warn|fail|crit): ([^\[\s]+)\[")

dropping = False
for line in sys.stdin:
    header = HEADER.match(line)
    if header is not None:
        dropping = header.group(1) == "info" and header.group(2) in NOISY
    elif not line.startswith(" "):
        dropping = False
    if not dropping:
        sys.stdout.write(line)
