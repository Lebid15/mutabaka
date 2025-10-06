"""
Utility functions for system statistics and disk usage.
"""
import os
import shutil
from pathlib import Path
from django.conf import settings


def get_size_format(size_bytes):
    """Convert bytes to human readable format."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"


def get_directory_size(path):
    """Calculate total size of a directory in bytes."""
    total = 0
    try:
        for entry in os.scandir(path):
            if entry.is_file(follow_symlinks=False):
                total += entry.stat().size
            elif entry.is_dir(follow_symlinks=False):
                total += get_directory_size(entry.path)
    except (PermissionError, FileNotFoundError):
        pass
    return total


def get_database_size():
    """Get the size of the database file."""
    try:
        db_path = settings.DATABASES['default']['NAME']
        if os.path.exists(db_path):
            size_bytes = os.path.getsize(db_path)
            return {
                'bytes': size_bytes,
                'formatted': get_size_format(size_bytes),
                'path': db_path
            }
    except Exception as e:
        return {
            'bytes': 0,
            'formatted': 'N/A',
            'path': str(e)
        }
    return {
        'bytes': 0,
        'formatted': 'N/A',
        'path': 'Database file not found'
    }


def get_media_size():
    """Get the total size of media files."""
    try:
        media_root = settings.MEDIA_ROOT
        if os.path.exists(media_root):
            size_bytes = get_directory_size(media_root)
            file_count = sum(1 for _ in Path(media_root).rglob('*') if _.is_file())
            return {
                'bytes': size_bytes,
                'formatted': get_size_format(size_bytes),
                'path': media_root,
                'file_count': file_count
            }
    except Exception as e:
        return {
            'bytes': 0,
            'formatted': 'N/A',
            'path': str(e),
            'file_count': 0
        }
    return {
        'bytes': 0,
        'formatted': 'N/A',
        'path': 'Media directory not found',
        'file_count': 0
    }


def get_static_size():
    """Get the total size of static files."""
    try:
        static_root = getattr(settings, 'STATIC_ROOT', None)
        if static_root and os.path.exists(static_root):
            size_bytes = get_directory_size(static_root)
            return {
                'bytes': size_bytes,
                'formatted': get_size_format(size_bytes),
                'path': static_root
            }
    except Exception:
        pass
    return {
        'bytes': 0,
        'formatted': 'N/A',
        'path': 'Static files not collected'
    }


def get_disk_usage():
    """Get disk usage statistics for the drive where Django is installed."""
    try:
        # Get the path of the Django project (BASE_DIR)
        base_dir = settings.BASE_DIR
        usage = shutil.disk_usage(base_dir)
        
        total = usage.total
        used = usage.used
        free = usage.free
        percent_used = (used / total) * 100 if total > 0 else 0
        
        return {
            'total': {
                'bytes': total,
                'formatted': get_size_format(total)
            },
            'used': {
                'bytes': used,
                'formatted': get_size_format(used)
            },
            'free': {
                'bytes': free,
                'formatted': get_size_format(free)
            },
            'percent_used': round(percent_used, 2),
            'path': str(base_dir)
        }
    except Exception as e:
        return {
            'total': {'bytes': 0, 'formatted': 'N/A'},
            'used': {'bytes': 0, 'formatted': 'N/A'},
            'free': {'bytes': 0, 'formatted': 'N/A'},
            'percent_used': 0,
            'path': str(e)
        }


def get_project_size():
    """Get the total size of the Django project directory."""
    try:
        base_dir = settings.BASE_DIR
        size_bytes = get_directory_size(base_dir)
        return {
            'bytes': size_bytes,
            'formatted': get_size_format(size_bytes),
            'path': str(base_dir)
        }
    except Exception as e:
        return {
            'bytes': 0,
            'formatted': 'N/A',
            'path': str(e)
        }


def get_all_stats():
    """Get all system statistics in one call."""
    return {
        'database': get_database_size(),
        'media': get_media_size(),
        'static': get_static_size(),
        'project': get_project_size(),
        'disk': get_disk_usage()
    }
