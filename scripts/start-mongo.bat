@echo off
rem 手动启动本地 MongoDB（无需管理员权限）
setlocal
set DATA=%LOCALAPPDATA%\MongoDB\data
set LOG=%LOCALAPPDATA%\MongoDB\mongod.log
set MONGOD=C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe

if not exist "%MONGOD%" (
  echo 找不到 mongod.exe，请确认 MongoDB 安装路径。
  exit /b 1
)

if not exist "%DATA%" mkdir "%DATA%"

echo 正在启动 MongoDB...
echo   数据目录：%DATA%
echo   日志文件：%LOG%
start "" "%MONGOD%" --dbpath "%DATA%" --logpath "%LOG%" --bind_ip 127.0.0.1 --port 27017
echo 已启动。可以用 mongosh 连接 mongodb://127.0.0.1:27017 检查。
