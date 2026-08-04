'use strict';
'require view';
'require rpc';
'require poll';

var callOnlineUserlist = rpc.declare({
	object: 'luci.onliner',
	method: 'getOnlineUserlist',
	expect: { userlist: [] }
});

var callRouteTable = rpc.declare({
	object: 'luci.onliner',
	method: 'getRouteTable',
	expect: { routetable: [] }
});

var callRouteRules = rpc.declare({
	object: 'luci.onliner',
	method: 'getRouteRules',
	expect: { routerules: [] }
});

// 过滤器状态变量
var activeFilter = 'all';
var filterHideFe80 = false;
var filterIPv4Only = false;
var filterIPv6Only = false;

// 新增：状态过滤器状态
var filterHideFailed = false;
var filterHideStale = false;
var filterReachableOnly = false;

var searchTerm = ''; 

// 渲染 IP 及其邻居状态 Badge
function renderIPAddress(ipString) {
	if (!ipString || ipString === '-' || ipString === 'null') return '-';
	var ips = ipString.split('/');
	var nodes = [];
	
	ips.forEach(function(ipItem) {
		if (!ipItem || ipItem === 'null') return;
		
		var rawIp = ipItem;
		var status = '';
		
		var match = ipItem.match(/(.*)\[(.*)\]/);
		if (match) {
			rawIp = match[1];
			status = match[2].toUpperCase();
		}

		if (rawIp === 'null') return;

		var statusBadge = null;
		if (status) {
			var badgeStyle = 'margin-left: 6px; font-size: 0.8em; padding: 1px 4px; border-radius: 3px; font-weight: bold; color: #fff; line-height: 1.2; font-family: sans-serif;';
			var bgColor = '#7f8c8d'; 

			if (status === 'REACHABLE') {
				bgColor = '#2ecc71'; 
			} else if (status === 'FAILED') {
				bgColor = '#e74c3c'; 
			} else if (status === 'PROBE' || status === 'DELAY') {
				bgColor = '#f39c12'; 
			}

			statusBadge = E('span', { 'style': badgeStyle + ' background-color: ' + bgColor + ';' }, [ status ]);
		}
		
		var ipNode = E('div', { 
			'style': 'word-break:break-all; font-weight:500; font-family:monospace; margin-bottom: 4px; display: flex; align-items: center; flex-wrap: wrap;' 
		}, [
			E('span', {}, rawIp),
			statusBadge
		]);
		
		nodes.push(ipNode);
	});
	return nodes;
}

function renderNetworkStatus(info) {
	if (!info.is_wifi) {
		return E('span', { 'style': 'font-size: 0.9em;' }, [
			E('strong', {}, '🖧 '), _('Wired')
		]);
	}

	var ssidText = info.ssid || 'Wi-Fi';
	if (ssidText === 'null') ssidText = 'Wi-Fi';

	return E('div', { 'style': 'display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px;' }, [
		E('span', { 'class': 'label success', 'style': 'margin: 0; background-color: #2980b9; font-size: 0.85em;' }, [
			'📶 ' + ssidText
		]),
		E('span', { 'style': 'font-size: 0.9em; font-weight: bold;' }, [
			(info.signal || '0') + ' dBm'
		])
	]);
}

function formatLeaseTime(expires) {
	if (expires === undefined || expires === null || expires === '-' || typeof expires !== 'number' || expires <= 0) {
		return '-';
	}
	
	var h = Math.floor(expires / 3600);
	var m = Math.floor((expires % 3600) / 60);
	var s = expires % 60;

	var res = [];
	if (h > 0) res.push(h + 'h');
	if (m > 0 || h > 0) res.push(m + 'm');
	res.push(s + 's');

	return res.join(' ');
}

// 清洗并根据勾选框动态过滤 IP 地址
function cleanIpAddressByFlags(ipStr) {
	if (!ipStr || ipStr === '-' || ipStr === 'null') return '';
	var parts = ipStr.split('/');
	var retained = [];

	parts.forEach(function(ipItem) {
		if (!ipItem || ipItem === 'null') return;
		
		var status = '';
		var match = ipItem.match(/(.*)\[(.*)\]/);
		if (match) {
			status = match[2].toUpperCase();
		}

		// 执行状态级过滤器拦截
		if (filterHideFailed && status === 'FAILED') return;
		if (filterHideStale && status === 'STALE') return;
		if (filterReachableOnly && status !== 'REACHABLE') return;

		var cleanIp = ipItem.replace(/\[.*\]/, ''); 
		var isV6 = (cleanIp.indexOf(':') !== -1);
		var isFe80 = (isV6 && cleanIp.toLowerCase().indexOf('fe80:') === 0);

		if (filterIPv4Only && isV6) return;
		if (filterIPv6Only && !isV6) return;
		if (filterHideFe80 && isFe80) return;

		retained.push(ipItem);
	});

	return retained.join('/');
}

function renderControlBar(list, container, updateCallback, tableUpdateCallback) {
	var cAll = list.length;
	var cWifi = 0, cWired = 0;

	list.forEach(function(info) {
		if (info.is_wifi) cWifi++; else cWired++;
	});

	var createTab = function(type, label, count) {
		var isActive = (activeFilter === type);
		return E('button', {
			'class': isActive ? 'btn cbi-button-action' : 'btn cbi-button',
			'style': 'padding: 5px 12px; font-weight: bold; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;',
			'click': function(ev) {
				ev.preventDefault();
				activeFilter = type;
				updateCallback(); 
			}
		}, [
			label,
			E('span', { 
				'class': 'badge', 
				'style': isActive ? 'margin-left:4px; background:rgba(255,255,255,0.25); color:inherit;' : 'margin-left:4px;' 
			}, count)
		]);
	};

	var createCheckbox = function(id, labelText, currentValue, onChangeFn) {
		var chk = E('input', {
			'type': 'checkbox',
			'id': id,
			'class': 'cbi-input-checkbox',
			'style': 'margin: 0 6px 0 0; cursor: pointer; vertical-align: middle;',
			'change': function(ev) {
				onChangeFn(ev.target.checked);
				updateCallback(); 
			}
		});
		if (currentValue) chk.checked = true;

		return E('span', { 'style': 'display: inline-flex; align-items: center; white-space: nowrap; margin-right: 5px;' }, [
			chk,
			E('label', { 'for': id, 'style': 'cursor: pointer; font-weight: bold; font-size: 13px; margin: 0; user-select: none;' }, labelText)
		]);
	};

	var handleForceRefresh = function(ev) {
		ev.preventDefault();
		window.location.reload();
	};

	return E('div', { 
		'class': 'cbi-section-descr',
		'style': 'margin-bottom: 20px; padding-bottom: 15px; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px dashed rgba(128, 128, 128, 0.3); background: transparent;' 
	}, [
		E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;' }, [
			E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 6px;' }, [
				createTab('all', _('All Clients'), cAll),
				createTab('wifi', _('Wireless'), cWifi),
				createTab('wired', _('Wired'), cWired)
			]),
			// 过滤面板整合
			E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 15px; align-items: center;' }, [
				E('strong', { 'style': 'font-size: 13px;' }, '⚙️ ' + _('IP Filters') + ':'),
				createCheckbox('chk_fe80', _('Filter fe80'), filterHideFe80, function(val) { filterHideFe80 = val; }),
				createCheckbox('chk_ipv4', _('IPv4 Only'), filterIPv4Only, function(val) { 
					filterIPv4Only = val; if (val) filterIPv6Only = false; 
				}),
				createCheckbox('chk_ipv6', _('IPv6 Only'), filterIPv6Only, function(val) { 
					filterIPv6Only = val; if (val) filterIPv4Only = false; 
				})
			])
		]),

		// 新增：邻居状态动态过滤栏
		E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 15px; align-items: center; background: rgba(0,0,0,0.02); padding: 6px 10px; border-radius: 4px;' }, [
			E('strong', { 'style': 'font-size: 13px;' }, '🔍 ' + _('Status Filters') + ':'),
			createCheckbox('chk_hide_failed', _('Filter FAILED'), filterHideFailed, function(val) { 
				filterHideFailed = val; if(val) filterReachableOnly = false;
			}),
			createCheckbox('chk_hide_stale', _('Filter STALE'), filterHideStale, function(val) { 
				filterHideStale = val; if(val) filterReachableOnly = false;
			}),
			createCheckbox('chk_reachable_only', _('REACHABLE Only'), filterReachableOnly, function(val) { 
				filterReachableOnly = val;
				if (val) { filterHideFailed = false; filterHideStale = false; }
			})
		]),
		
		E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;' }, [
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 8px; flex: 1; max-width: 350px;' }, [
				E('strong', { 'style': 'font-size: 13px; white-space: nowrap;' }, '🔍 ' + _('Search') + ':'),
				E('input', {
					'type': 'text',
					'class': 'cbi-input-text',
					'placeholder': _('Search Hostname, IP, MAC...'),
					'style': 'width: 100%; padding: 4px 8px; font-size: 13px;',
					'value': searchTerm,
					'input': function(ev) {
						searchTerm = ev.target.value.trim().toLowerCase();
						tableUpdateCallback(); 
					}
				})
			]),
			E('div', { 'style': 'display: flex; gap: 8px;' }, [
				E('button', {
					'class': 'btn cbi-button-neutral',
					'style': 'padding: 4px 12px; font-size: 13px; font-weight: bold;',
					'click': handleForceRefresh
				}, [ '🔄 ' + _('Force Refresh') ])
			])
		])
	]);
}

function renderUserTable(list) {
	var table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Hostname')),
			E('th', { 'class': 'th' }, _('IP Address')),
			E('th', { 'class': 'th' }, _('MAC address')),
			E('th', { 'class': 'th' }, _('Interface')),
			E('th', { 'class': 'th' }, _('Expires In')),
			E('th', { 'class': 'th' }, _('Network / Signal'))
		])
	]);

	var displayRows = [];

	list.forEach(function(info) {
		if (!info.macaddr || info.macaddr === 'null' || info.macaddr === '') return;
		if (!info.ipaddr || info.ipaddr === 'null' || info.ipaddr === '-') return;

		if (activeFilter === 'wifi' && !info.is_wifi) return;
		if (activeFilter === 'wired' && info.is_wifi) return;

		// 调用集成了状态过滤的清洗函数
		var cleanedIp = cleanIpAddressByFlags(info.ipaddr);

		// 如果当前行的所有 IP 在经过过滤条件后都被干掉了，说明这行不需要展现
		if (cleanedIp === '') {
			return;
		}

		if (searchTerm !== '') {
			var hName = (info.hostname || '').toLowerCase();
			var mAddr = (info.macaddr || '').toLowerCase();
			var iFace = (info.device || '').toLowerCase();
			var sSid = (info.ssid || '').toLowerCase();
			var ips = cleanedIp.toLowerCase();

			if (hName.indexOf(searchTerm) === -1 &&
				mAddr.indexOf(searchTerm) === -1 &&
				iFace.indexOf(searchTerm) === -1 &&
				sSid.indexOf(searchTerm) === -1 &&
				ips.indexOf(searchTerm) === -1) {
				return;
			}
		}

		var hostNameClean = info.hostname || '?';
		if (hostNameClean.toLowerCase() === 'null') hostNameClean = '?';

		var devClean = info.device || '-';
		if (devClean.toLowerCase() === 'null') devClean = '-';

		var renderInfo = Object.assign({}, info, { 
			ipaddr: cleanedIp,
			hostname: hostNameClean,
			device: devClean
		});
		displayRows.push(renderInfo);
	});

	if (!displayRows.length) {
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'colspan': '6' }, _('No matching online users'))
		]));
		return table;
	}

	displayRows.sort(function(a, b) {
		return L.naturalCompare(a.ipaddr || '', b.ipaddr || '');
	});

	displayRows.forEach(function(info) {
		var macNode = '-';
		if (info.macaddr) {
			macNode = E('a', {
				'href': 'https://www.macvendorlookup.com/api/v2/' + encodeURIComponent(info.macaddr),
				'target': '_blank',
				'title': _('Click to query MAC vendor in a new window'),
				'style': 'font-family: monospace; text-decoration: underline; cursor: pointer;'
			}, info.macaddr);
		}

		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'vertical-align: middle;' }, info.hostname),
			E('td', { 'class': 'td', 'style': 'vertical-align: middle;' }, renderIPAddress(info.ipaddr)),
			E('td', { 'class': 'td', 'style': 'vertical-align: middle;' }, macNode),
			E('td', { 'class': 'td', 'style': 'vertical-align: middle;' }, info.device),
			E('td', { 'class': 'td', 'style': 'vertical-align: middle; font-family: monospace;' }, formatLeaseTime(info.expires)),
			E('td', { 'class': 'td', 'style': 'vertical-align: middle;' }, renderNetworkStatus(info))
		]));
	});

	return table;
}

// 渲染内核 IP 路由表 (类似 `route` 命令输出)，支持按路由表分组
function renderRouteTable(tableGroups) {
	var container = E('div', {});

	if (!tableGroups || !tableGroups.length) {
		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'style': 'text-align:center; padding:16px; color:#999;' }, _('No routing entries'))
				])
			])
		]));
		return container;
	}

	var mono = 'font-family: monospace;';

	// 每次调用都新建一组表头，避免 DOM 节点被多个表共享导致丢失
	var buildHeaderCells = function() {
		return [
			E('th', { 'class': 'th' }, _('Destination')),
			E('th', { 'class': 'th' }, _('Gateway')),
			E('th', { 'class': 'th' }, _('Genmask')),
			E('th', { 'class': 'th' }, _('Flags')),
			E('th', { 'class': 'th' }, _('Metric')),
			E('th', { 'class': 'th' }, _('Ref')),
			E('th', { 'class': 'th' }, _('Use')),
			E('th', { 'class': 'th' }, _('Iface'))
		];
	};

	tableGroups.forEach(function(group) {
		var titleText = (group.table_name == 'main')
			? _('Table: main (default)')
			: _('Table: %s (ID %s)').replace('%s', group.table_name).replace('%s', group.table_id);

		// 每个表独立创建一组表头单元格
		var headerCells = buildHeaderCells();

		container.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'margin-bottom: 8px;' }, [
				E('h3', { 'style': 'margin: 0 0 6px 0; font-size: 14px; color: #2c3e50;' }, titleText),
				E('div', { 'style': 'font-size: 12px; color: #7f8c8d; margin-bottom: 6px;' },
					_('%d route(s)').replace('%d', (group.routes || []).length))
			]),
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, headerCells)
			].concat(
				(!group.routes || !group.routes.length)
					? [ E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': '8' }, _('No routing entries')) ]) ]
					: group.routes.map(function(r) {
						return E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': mono }, r.destination || '-'),
							E('td', { 'class': 'td', 'style': mono }, r.gateway || '-'),
							E('td', { 'class': 'td', 'style': mono }, r.genmask || '-'),
							E('td', { 'class': 'td', 'style': mono + ' font-weight: bold;' }, r.flags || '-'),
							E('td', { 'class': 'td', 'style': mono }, r.metric || '0'),
							E('td', { 'class': 'td', 'style': mono }, r.ref || '0'),
							E('td', { 'class': 'td', 'style': mono }, r.use || '0'),
							E('td', { 'class': 'td' }, r.iface || '-')
						]);
					})
			))
		]));
	});

	return container;
}

// 渲染策略路由规则 (ip rule show)
function renderRouteRules(rules) {
	var table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Priority')),
			E('th', { 'class': 'th' }, _('From')),
			E('th', { 'class': 'th' }, _('To')),
			E('th', { 'class': 'th' }, _('In Iface')),
			E('th', { 'class': 'th' }, _('Out Iface')),
			E('th', { 'class': 'th' }, _('Action')),
			E('th', { 'class': 'th' }, _('Target'))
		])
	]);

	if (!rules || !rules.length) {
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'text-align:center; padding:16px; color:#999;', 'colspan': '7' }, _('No routing rules'))
		]));
		return table;
	}

	var mono = 'font-family: monospace;';

	rules.forEach(function(r) {
		// 高亮 lookup 动作的表名（可能为数字或表名）
		var actionNode = E('span', { 'style': mono + ' font-weight: bold; color: #2980b9;' }, r.action || '-');

		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': mono + ' color:#7f8c8d;' }, r.priority || '-'),
			E('td', { 'class': 'td', 'style': mono }, r.from || 'all'),
			E('td', { 'class': 'td', 'style': mono }, r.to || 'all'),
			E('td', { 'class': 'td', 'style': mono }, r.iif || '-'),
			E('td', { 'class': 'td', 'style': mono }, r.oif || '-'),
			E('td', { 'class': 'td' }, actionNode),
			E('td', { 'class': 'td', 'style': mono + ' font-weight: bold;' }, r.target || '-')
		]));
	});

	return table;
}

function loadOnlineData() {
	return L.resolveDefault(callOnlineUserlist(), []);
}

function loadRouteTableData() {
	return L.resolveDefault(callRouteTable(), []);
}

function loadRouteRulesData() {
	return L.resolveDefault(callRouteRules(), []);
}

return view.extend({
	label: _('Online Clients'),

	load: function() {
		return Promise.all([
			loadOnlineData(),
			loadRouteTableData(),
			loadRouteRulesData()
		]);
	},

	render: function(data) {
		var onlineData = data[0] || [];
		var routeData = data[1] || [];
		var rulesData = data[2] || [];

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Online User Overview')),
			E('div', { 'class': 'cbi-map-descr' }, _('Real-time display of currently connected wired and wireless clients.')),
			E('div', { 'id': 'onliner-content-area' }),
			E('h2', { 'style': 'margin-top: 30px;' }, _('Routing Table')),
			E('div', { 'class': 'cbi-map-descr' }, _('Kernel IP routing table, similar to the output of the route command.')),
			E('div', { 'id': 'onliner-route-table-wrapper' }, [
				renderRouteTable(routeData)
			]),
			E('h2', { 'style': 'margin-top: 30px;' }, _('Routing Rules')),
			E('div', { 'class': 'cbi-map-descr' }, _('Policy routing rules, similar to the output of the ip rule command.')),
			E('div', { 'id': 'onliner-route-rules-wrapper', 'class': 'cbi-section' }, [
				renderRouteRules(rulesData)
			])
		]);

		var refreshAllContents = function(rawData) {
			var targetNode = container.querySelector('#onliner-content-area');
			if (!targetNode) return;

			var newContent = E('div', {}, [
				renderControlBar(rawData, container, function() {
					refreshAllContents(rawData);
				}, function() {
					refreshTableOnly(rawData);
				}),
				E('div', { 'id': 'onliner-table-wrapper', 'class': 'cbi-section' }, [
					renderUserTable(rawData)
				])
			]);

			targetNode.innerHTML = '';
			targetNode.appendChild(newContent);
		};

		var refreshTableOnly = function(rawData) {
			var tableWrapper = container.querySelector('#onliner-table-wrapper');
			if (!tableWrapper) return;
			tableWrapper.innerHTML = '';
			tableWrapper.appendChild(renderUserTable(rawData));
		};

		var refreshRouteTable = function(routeTableData) {
			var routeWrapper = container.querySelector('#onliner-route-table-wrapper');
			if (!routeWrapper) return;
			routeWrapper.innerHTML = '';
			routeWrapper.appendChild(renderRouteTable(routeTableData));
		};

		var refreshRouteRules = function(routeRulesData) {
			var rulesWrapper = container.querySelector('#onliner-route-rules-wrapper');
			if (!rulesWrapper) return;
			rulesWrapper.innerHTML = '';
			rulesWrapper.appendChild(renderRouteRules(routeRulesData));
		};

		refreshAllContents(onlineData);
		refreshRouteTable(routeData);
		refreshRouteRules(rulesData);

		poll.add(function() {
			return Promise.all([
				loadOnlineData(),
				loadRouteTableData(),
				loadRouteRulesData()
			]).then(function(results) {
				var newOnlineData = results[0] || [];
				var newRouteData = results[1] || [];
				var newRulesData = results[2] || [];
				var activeEl = document.activeElement;
				if (activeEl && activeEl.classList.contains('cbi-input-text') && searchTerm !== '') {
					refreshTableOnly(newOnlineData);
				} else {
					refreshAllContents(newOnlineData);
				}
				refreshRouteTable(newRouteData);
				refreshRouteRules(newRulesData);
			});
		}, 60);

		return container;
	}
});
