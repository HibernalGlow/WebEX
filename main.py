#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebEX 工具主入口
"""

import sys
from pathlib import Path

# 添加 src 目录到 Python 路径
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from download_monitor import main as download_monitor_main


def main():
    """主函数"""
    print("WebEX 工具集")
    print("=" * 50)
    print("1. 下载文件夹监控 (自动去掉 .crdownload 后缀)")
    print("=" * 50)
    
    # 直接启动下载监控
    download_monitor_main()


if __name__ == "__main__":
    main()
