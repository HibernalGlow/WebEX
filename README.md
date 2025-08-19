# WebEX 工具集

## 下载文件夹监控脚本

自动监控下载文件夹，去掉 Chrome 下载过程中产生的 `.crdownload` 后缀文件。

### 功能特点

- 🔍 **实时监控**: 自动监控下载文件夹，检测 `.crdownload` 文件
- 🚀 **智能处理**: 等待文件下载完成后自动去掉 `.crdownload` 后缀
- 🔄 **重复处理**: 如果目标文件已存在，自动添加数字后缀避免冲突
- 📝 **日志记录**: 详细的日志记录，方便查看处理过程
- 🧹 **批量清理**: 支持一次性清理现有的 `.crdownload` 文件

### 安装依赖

```bash
pip install watchdog
```

或者使用 uv (推荐):

```bash
uv sync
```

### 使用方法

#### 1. 使用默认下载文件夹

```bash
python main.py
```

#### 2. 直接运行监控脚本

```bash
python src/download_monitor.py
```

#### 3. 指定自定义下载文件夹

```bash
python src/download_monitor.py --folder "D:\Downloads"
```

#### 4. 清理现有的 .crdownload 文件

```bash
python src/download_monitor.py --clean
```

#### 5. 指定文件夹并清理现有文件

```bash
python src/download_monitor.py --folder "D:\Downloads" --clean
```

### 工作原理

1. **文件监控**: 使用 `watchdog` 库监控指定文件夹的文件变化
2. **下载检测**: 检测到 `.crdownload` 文件时，等待文件下载完成
3. **智能重命名**: 下载完成后自动去掉 `.crdownload` 后缀
4. **冲突处理**: 如果目标文件已存在，添加数字后缀 `(1)`, `(2)` 等

### 支持的文件夹

脚本会自动尝试以下路径作为默认下载文件夹：

- `%USERPROFILE%\Downloads` (Windows 英文)
- `%USERPROFILE%\下载` (Windows 中文)
- `C:\Users\{用户名}\Downloads`

### 注意事项

- 脚本需要对下载文件夹有读写权限
- 按 `Ctrl+C` 可以停止监控
- 建议在 Chrome 浏览器下载文件时运行此脚本

### 日志输出示例

```
2024-07-12 10:30:15 - __main__ - INFO - 开始监控下载文件夹: C:\Users\User\Downloads
2024-07-12 10:30:45 - __main__ - INFO - 检测到下载文件: example.pdf.crdownload
2024-07-12 10:30:50 - __main__ - INFO - 文件下载完成并重命名: example.pdf.crdownload -> example.pdf
```

### 常见问题

**Q: 脚本没有检测到 .crdownload 文件？**
A: 确保指定的下载文件夹路径正确，并且 Chrome 浏览器确实在该文件夹下载文件。

**Q: 重命名后的文件名有数字后缀？**
A: 这是正常的冲突处理机制，说明目标文件名已存在，脚本自动添加数字后缀避免覆盖。

**Q: 如何停止监控？**
A: 在运行脚本的终端中按 `Ctrl+C` 即可停止监控。