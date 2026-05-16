'use strict';
'require view';
'require rpc';
'require poll';

var callOnlineUserlist = rpc.declare({
	object: 'luci.onliner',
	method: 'getOnlineUserlist',
	expect: { userlist: [] }
});

// 处理多IP分行并根据类型着色的辅助函数
function renderIPAddress(ipString) {
	if (!ipString) return '-';
	
	var ips = ipString.split('/');
	var nodes = [];
	
	ips.forEach(function(ip) {
		if (!ip) return;
		
		var style = 'word-break:break-all; font-weight:500; font-family:monospace;';
		var typeText = '';

		// 1. 判断是否为 IPv6
		if (ip.indexOf(':') !== -1) {
			var ipL = ip.toLowerCase();
			
			if (ipL.indexOf('fe80:') === 0) {
				// 链路本地地址 (Link-Local) -> 橙色/棕色
				style += 'color: #b58105; font-size: 0.9em;';
				typeText = ' [Link-Local]';
			} else if (ipL.indexOf('fd') === 0 || ipL.indexOf('fc') === 0) {
				// 唯一本地地址 (ULA, 如 fd00::) -> 紫色
				style += 'color: #8e44ad; font-size: 0.9em;';
				typeText = ' [ULA]';
			} else if (ipL.indexOf('2') === 0 || ipL.indexOf('3') === 0) {
				// 全局单播地址 (GUA, 公网 IPv6，以 2xxx: 或 3xxx: 开头)
				// 进一步判断是否为临时地址（Linux/Windows 临时 IPv6 通常无特定前缀，但此处可通过特定后缀逻辑或统一作为公网处理）
				// 为了界面清晰，这里将标准的公网 IP 设为显眼的深蓝色，如果是常见临时标记可以再区分，通常建议公网统一用蓝色
				style += 'color: #1a5f7a; font-size: 0.95em;';
				typeText = ' [GUA]';
			} else {
				// 其他 IPv6 地址 -> 灰色
				style += 'color: #666666; font-size: 0.9em;';
			}
		} else {
			// 2. IPv4 地址 -> 标准深绿色/黑色，字号稍大突出
			style += 'color: #2e7d32; font-size: 1em;';
		}
		
		var ipNode = E('div', { 'style': style }, [
			ip,
			typeText ? E('span', { 'style': 'font-size:0.8em; font-weight:normal; opacity:0.7; margin-left:5px;' }, typeText) : ''
		]);
		
		nodes.push(ipNode);
	});
	
	return nodes;
}

function renderUserTable(list) {
	var table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Hostname')),
			E('th', { 'class': 'th' }, _('IP Address')),
			E('th', { 'class': 'th' }, _('MAC address')),
			E('th', { 'class': 'th' }, _('Interface'))
		])
	]);

	if (!Array.isArray(list) || !list.length) {
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', {
				'class': 'td',
				'colspan': '4'
			}, _('No online users'))
		]));

		return table;
	}

	list.sort(function(a, b) {
		return L.naturalCompare(a.ipaddr || '', b.ipaddr || '');
	});

	list.forEach(function(info) {
		if (!info.ipaddr && !info.macaddr)
			return;

		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, info.hostname || '?'),
			E('td', { 'class': 'td' }, renderIPAddress(info.ipaddr)),
			E('td', { 'class': 'td' }, info.macaddr || '-'),
			E('td', { 'class': 'td' }, info.device || '-')
		]));
	});

	return table;
}

function loadOnlineData() {
	return L.resolveDefault(callOnlineUserlist(), []);
}

return view.extend({
	load: function() {
		return loadOnlineData();
	},

	render: function(data) {
		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Online User Overview')),
			E('div', { 'class': 'cbi-map-descr' }, _('Real-time display of currently connected wired and wireless clients.')),
			E('div', { 'class': 'cbi-section' }, [
				renderUserTable(data)
			])
		]);

		poll.add(function() {
			return loadOnlineData().then(function(newData) {
				var newNode = E('div', { 'class': 'cbi-section' }, [
					renderUserTable(newData)
				]);

				var oldSection = container.querySelector('.cbi-section');
				if (oldSection) {
					container.replaceChild(newNode, oldSection);
				}
			});
		}, 5);

		return container;
	}
});
