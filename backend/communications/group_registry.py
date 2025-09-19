# Simple in-process registry to track Channels group membership sizes for debugging
# Note: This is suitable for single-process dev with InMemoryChannelLayer. For Redis/multi-worker,
# this is only an approximate local view.
from typing import Dict, Set

_GROUP_CHANNELS: Dict[str, Set[str]] = {}

def add_channel(group: str, channel: str) -> int:
    if group not in _GROUP_CHANNELS:
        _GROUP_CHANNELS[group] = set()
    _GROUP_CHANNELS[group].add(channel)
    return len(_GROUP_CHANNELS[group])

def remove_channel(group: str, channel: str) -> int:
    if group in _GROUP_CHANNELS:
        _GROUP_CHANNELS[group].discard(channel)
        if not _GROUP_CHANNELS[group]:
            del _GROUP_CHANNELS[group]
            return 0
        return len(_GROUP_CHANNELS[group])
    return 0

def get_count(group: str) -> int:
    if group in _GROUP_CHANNELS:
        return len(_GROUP_CHANNELS[group])
    return 0
