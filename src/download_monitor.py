#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载文件夹监控脚本
自动监控下载文件夹，去掉 .crdownload 后缀
"""

import os
import time
import logging
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


class DownloadHandler(FileSystemEventHandler):
    """下载文件处理器"""
    
    def __init__(self):
        super().__init__()
        self.logger = logging.getLogger(__name__)
    
    def on_modified(self, event):
        """文件修改事件处理"""
        if event.is_directory:
            return
        
        file_path = Path(event.src_path)
        
        # 检查是否是 .crdownload 文件
        if file_path.suffix == '.crdownload':
            self.handle_crdownload_file(file_path)
    
    def on_moved(self, event):
        """文件移动事件处理"""
        if event.is_directory:
            return
        
        dest_path = Path(event.dest_path)
        
        # 检查是否是 .crdownload 文件被重命名
        if dest_path.suffix == '.crdownload':
            self.handle_crdownload_file(dest_path)
    
    def handle_crdownload_file(self, file_path):
        """处理 .crdownload 文件"""
        try:
            # 检查文件是否存在
            if not file_path.exists():
                return
            
            # 等待文件下载完成
            if self.is_file_being_downloaded(file_path):
                self.logger.info(f"检测到下载文件: {file_path.name}")
                return
            
            # 去掉 .crdownload 后缀
            new_path = file_path.with_suffix('')
            
            # 如果目标文件已存在，添加数字后缀
            if new_path.exists():
                counter = 1
                while True:
                    stem = new_path.stem
                    suffix = new_path.suffix
                    parent = new_path.parent
                    new_path = parent / f"{stem}({counter}){suffix}"
                    if not new_path.exists():
                        break
                    counter += 1
            
            # 重命名文件
            file_path.rename(new_path)
            self.logger.info(f"文件下载完成并重命名: {file_path.name} -> {new_path.name}")
            
        except Exception as e:
            self.logger.error(f"处理文件时发生错误: {e}")
    
    def is_file_being_downloaded(self, file_path):
        """检查文件是否还在下载中"""
        try:
            # 记录当前文件大小
            current_size = file_path.stat().st_size
            
            # 等待一小段时间
            time.sleep(2)
            
            # 检查文件是否还存在
            if not file_path.exists():
                return False
            
            # 检查文件大小是否发生变化
            new_size = file_path.stat().st_size
            return current_size != new_size
            
        except (OSError, FileNotFoundError):
            return False


class DownloadMonitor:
    """下载文件夹监控器"""
    
    def __init__(self, download_folder=None):
        self.download_folder = self.get_download_folder(download_folder)
        self.observer = Observer()
        self.handler = DownloadHandler()
        self.logger = self.setup_logger()
    
    def get_download_folder(self, folder=None):
        """获取下载文件夹路径"""
        if folder:
            return Path(folder)
        
        # 尝试获取系统默认下载文件夹
        default_paths = [
            Path("D:/Downloads"),
        ]
        
        for path in default_paths:
            if path.exists():
                return path
        
        # 如果都不存在，使用用户主目录
        return Path.home()
    
    def setup_logger(self):
        """设置日志"""
        logger = logging.getLogger(__name__)
        logger.setLevel(logging.INFO)
        
        # 创建控制台处理器
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        
        # 创建格式器
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(formatter)
        
        # 添加处理器到日志器
        if not logger.handlers:
            logger.addHandler(console_handler)
        
        return logger
    
    def start_monitoring(self):
        """开始监控"""
        try:
            # 验证下载文件夹是否存在
            if not self.download_folder.exists():
                self.logger.error(f"下载文件夹不存在: {self.download_folder}")
                return
            
            self.logger.info(f"开始监控下载文件夹: {self.download_folder}")
            
            # 设置观察者
            self.observer.schedule(
                self.handler, 
                str(self.download_folder), 
                recursive=False
            )
            
            # 启动观察者
            self.observer.start()
            
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                self.logger.info("收到中断信号，正在停止监控...")
                self.stop_monitoring()
                
        except Exception as e:
            self.logger.error(f"启动监控时发生错误: {e}")
    
    def stop_monitoring(self):
        """停止监控"""
        if self.observer.is_alive():
            self.observer.stop()
            self.observer.join()
            self.logger.info("监控已停止")
    
    def clean_existing_crdownload_files(self):
        """清理现有的 .crdownload 文件"""
        try:
            crdownload_files = list(self.download_folder.glob("*.crdownload"))
            
            if not crdownload_files:
                self.logger.info("没有找到 .crdownload 文件")
                return
            
            self.logger.info(f"找到 {len(crdownload_files)} 个 .crdownload 文件")
            
            for file_path in crdownload_files:
                try:
                    # 检查文件是否还在下载中
                    if self.handler.is_file_being_downloaded(file_path):
                        self.logger.info(f"文件正在下载中，跳过: {file_path.name}")
                        continue
                    
                    # 去掉 .crdownload 后缀
                    new_path = file_path.with_suffix('')
                    
                    # 如果目标文件已存在，添加数字后缀
                    if new_path.exists():
                        counter = 1
                        while True:
                            stem = new_path.stem
                            suffix = new_path.suffix
                            parent = new_path.parent
                            new_path = parent / f"{stem}({counter}){suffix}"
                            if not new_path.exists():
                                break
                            counter += 1
                    
                    # 重命名文件
                    file_path.rename(new_path)
                    self.logger.info(f"清理完成: {file_path.name} -> {new_path.name}")
                    
                except Exception as e:
                    self.logger.error(f"清理文件 {file_path.name} 时发生错误: {e}")
                    
        except Exception as e:
            self.logger.error(f"清理现有文件时发生错误: {e}")


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="下载文件夹监控脚本")
    parser.add_argument(
        "--folder", 
        type=str, 
        help="指定要监控的下载文件夹路径"
    )
    parser.add_argument(
        "--clean", 
        action="store_true", 
        help="清理现有的 .crdownload 文件"
    )
    
    args = parser.parse_args()
    
    # 创建监控器
    monitor = DownloadMonitor(args.folder)
    
    # 如果指定了清理选项，先清理现有文件
    if args.clean:
        monitor.clean_existing_crdownload_files()
    
    # 开始监控
    monitor.start_monitoring()


if __name__ == "__main__":
    main()
