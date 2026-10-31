#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Tools to moor ships.

Second paragraph.
"""

__all__ = [
    "moor",  # the entry point
    "Harbor",
    "MAX",
    "missing",
]

MAX = 3


def moor(ship):
    if ship and ship.ready:  # +1 +1
        return [s for s in ship.crew if s.awake]  # +1 +1
    elif ship is None:  # +1
        return None
    while False:  # +1
        pass
    try:
        pass
    except ValueError:  # +1
        pass
    match ship:
        case 1:  # +1
            pass
        case _:  # like a default: +0
            pass
    return 1 if ship else 2  # +1


@dataclass
class Harbor:
    pass


def _private():
    pass
