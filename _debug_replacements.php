<?php

/**
 * Those replacements are done by the development server to test it locally
 * without esphttpd. This is needed mainly for places where the replacements
 * are given to JavaScript, to avoid syntax errors with
 */

$vers = '???';
$versfn = __DIR__ . '/../user/version.h';
$fwHash = '00000000';
if (file_exists($versfn)) {
	$f = file_get_contents($versfn);
	preg_match_all('/#define FW_V_.*? (\d+)/', $f, $vm);
#define FW_V_MAJOR 1
#define FW_V_MINOR 0
#define FW_V_PATCH 0
	$vers = $vm[1][0] . '.' . $vm[1][1] . '.' . $vm[1][2];
	$fwHash = trim(shell_exec('cd .. && git rev-parse --short HEAD'));
}

return [
	'title' => ESP_DEMO ? 'ESPTerm Web UI Demo' : 'ESPTerm local debug',

	'btn1' => 'OK',
	'btn2' => 'Cancel',
	'btn3' => '',
	'btn4' => '',
	'btn5' => 'Help',

	'bm1' => '01,'.ord('y'),
	'bm2' => '01,'.ord('n'),
	'bm3' => '',
	'bm4' => '',
	'bm5' => '05',

	'bc1' => '',
	'bc2' => '',
	'bc3' => '',
	'bc4' => '',
	'bc5' => '',

	'button_count' => 5,
	'labels_seq' => ESP_DEMO ? 'TESPTerm Web UI DemoOKCancelHelp' : 'TESPTerm local debugOKCancelHelp',
	'want_all_fn' => '0',

	'parser_tout_ms' => 10,
	'display_tout_ms' => 15,
	'display_cooldown_ms' => 35,
	'fn_alt_mode' => '1',

	'opmode' => '2',
	'sta_enable' => '1',
	'ap_enable' => '1',

	'tpw' => '60',
	'ap_channel' => '7',
	'ap_ssid' => 'TERM-027451',
	'ap_password' => '',
	'ap_hidden' => '0',

	'sta_ssid' => 'Cisco',
	'sta_password' => 'Passw0rd!',
	'sta_active_ip' => ESP_DEMO ? '192.168.82.66' : '192.168.0.19',
	'sta_active_ssid' => 'Cisco',

	'vers_fw' => $vers,
	'date' => date('Y-m-d'),
	'time' => date('G:i')." ".TIMEZONE,
	'vers_httpd' => '0.4',
	'vers_sdk' => '010502',
	'githubrepo' => 'https://github.com/espterm/espterm-firmware',
	'githubrepo_front' => 'https://github.com/espterm/espterm-front-end',
	'hash_backend' => $fwHash,
	'hash_frontend' => GIT_HASH,

	'ap_dhcp_time' => '120',
	'ap_dhcp_start' => '192.168.4.100',
	'ap_dhcp_end' => '192.168.4.200',
	'ap_addr_ip' => '192.168.4.1',
	'ap_addr_mask' => '255.255.255.0',

	'sta_dhcp_enable' => '1',
	'sta_addr_ip' => '192.168.0.33',
	'sta_addr_mask' => '255.255.255.0',
	'sta_addr_gw' => '192.168.0.1',

	'sta_mac' => '5c:cf:7f:02:74:51',
	'ap_mac' => '5e:cf:7f:02:74:51',

	'width' => '80',
	'height' => '25',
	'default_bg' => '0',
	'default_fg' => '7',
	'show_buttons' => '1',
	'show_config_links' => '1',
	'font_stack' => '',
	'font_size' => '20',

	'uart_baudrate' => 115200,
	'uart_stopbits' => 1,
	'uart_parity' => 2,

	'theme' => 0,
	'pwlock' => 0,
	'access_name' => 'espterm',

	'allow_decopt_12' => 0,

	'gpio2_conf' => 0,
	'gpio4_conf' => 1,
	'gpio5_conf' => 2,
	'gpio_initial' => '{"io2":0,"io4":0,"io5":1}',
];
