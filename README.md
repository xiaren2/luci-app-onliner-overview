# luci-app-onliner-概述
从https://github.com/lemonjc/luci-app-onliner-overview分支


移动了位置，修改了部分功能

<img width="1456" height="760" alt="image" src="https://github.com/user-attachments/assets/5ae35b5e-e4fa-42c4-997c-f6129bed3d54" />


一个轻量级的LuCI概览小部件，适用于OpenWrt / ImmortalWrt。

它直接在LuCI上显示在线客户端**状态 → 概述**页面。  
这个软件包不添加一个独立的菜单项或配置页面。

## 特点

- 在LuCI概览页面上显示在线客户端
- 显示主机名、IP地址、MAC地址和接口
- 用途 `rpcd` + `ucode` 后端
- 支持英语和简体中文

## 构建

克隆这个软件包到你的 OpenWrt / ImmortalWrt 源代码树中：

```sh
cd openwrt
git clone https://github.com/lemonjc/luci-app-onliner-overview.git package/custom/luci-app-onliner-overview
```

选择套餐：

```sh
生成菜单配置
```

路径：

```文本
LuCI -> 应用程序 -> luci-app-onliner-overview
```

构建：

```sh
编译软件包/自定义/Luci应用/Onliner概览/V=s
```

该`.ipk`软件包通常会在以下目录生成：

```文本
bin/packages/<架构>/base/
```

## 安装

将 上传 ``.ipk`` 文件到您的路由器并进行安装：

```sh
opkg install /tmp/luci-app-onliner-overview_*.ipk
```

Restart services and clear LuCI cache:

```sh
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache/*
```

Then log out of LuCI, log in again, and refresh the overview page.

## Test

Check the backend:

```sh
ubus list | grep luci.onliner
ubus call luci.onliner getOnlineUserlist
```

Example output:

```json
{
  "userlist": [
    {
      "hostname": "phone",
      "ipaddr": "192.168.1.23",
      "macaddr": "aa:bb:cc:dd:ee:ff",
      "device": "br-lan"
    }
  ]
}
```

## Notes

Client detection is based on DHCP leases, ARP entries and IPv6 neighbor entries, so the list may not always represent strict real-time online status.

## License

MIT
