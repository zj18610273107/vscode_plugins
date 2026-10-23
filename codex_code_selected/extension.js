const vscode = require('vscode');
const path = require('path');
const childProcess = require('child_process');
const net = require('net');
const os = require('os');

const ALT_V_SEQUENCE = '\u001bv';
const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';
const POWERSHELL_TIMEOUT_MS = 1500;
const MAX_CLIPBOARD_OUTPUT_BYTES = 6 * 1024 * 1024;
const COPY_URI_PATH = '/copy';
const COPY_URI_AUTHORITY = 'codex-publisher.codex-code-selected';
const COPY_SESSION_PATTERN = /^[0-9a-f]{32}$/;
const COPY_BLOCK_PATTERN = /^[1-9][0-9]{0,19}$/;
const COPY_PROTOCOL_VERSION = 1;
const COPY_RESPONSE_NOT_FOUND = 0;
const COPY_RESPONSE_OK = 1;
const COPY_SOCKET_TIMEOUT_MS = 2000;
const MAX_COPY_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	const sendWithPrefixCommand = vscode.commands.registerCommand(
		'codex.sendSelectedCode',
		() => sendSelectedCode(true)
	);
	const sendWithoutPrefixCommand = vscode.commands.registerCommand(
		'codex.sendSelectedCodeWithoutPrefix',
		() => sendSelectedCode(false)
	);
	const smartTerminalPasteCommand = vscode.commands.registerCommand(
		'codex.smartTerminalPaste',
		() => smartTerminalPaste()
	);
	const codeBlockCopyUriHandler = vscode.window.registerUriHandler({
		handleUri: (uri) => handleCodeBlockCopyUri(uri),
	});

	context.subscriptions.push(
		sendWithPrefixCommand,
		sendWithoutPrefixCommand,
		smartTerminalPasteCommand,
		codeBlockCopyUriHandler
	);
}

async function handleCodeBlockCopyUri(uri) {
	try {
		if (
			uri.scheme !== 'vscode'
			|| uri.authority !== COPY_URI_AUTHORITY
			|| uri.path !== COPY_URI_PATH
		)
			throw new Error('不支持的复制链接。');

		const params = new URLSearchParams(uri.query);
		if (
			params.size !== 2
			|| params.getAll('session').length !== 1
			|| params.getAll('block').length !== 1
		)
			throw new Error('复制链接参数无效。');
		const session = params.get('session') || '';
		const block = params.get('block') || '';
		if (!COPY_SESSION_PATTERN.test(session) || !COPY_BLOCK_PATTERN.test(block))
			throw new Error('复制链接参数无效。');

		const blockId = BigInt(block);
		if (blockId > 0xffffffffffffffffn)
			throw new Error('代码块编号超出范围。');

		const code = await requestCodeBlock(session, blockId);
		await vscode.env.clipboard.writeText(code);
		vscode.window.setStatusBarMessage('$(check) Codex 代码块已复制', 2000);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`复制 Codex 代码块失败：${message}`);
	}
}

function requestCodeBlock(session, blockId) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(codeCopySocketPath(session));
		const chunks = [];
		let responseBytes = 0;
		let settled = false;

		const fail = (error) => {
			if (settled)
				return;
			settled = true;
			socket.destroy();
			reject(error);
		};

		socket.setTimeout(COPY_SOCKET_TIMEOUT_MS);
		socket.once('connect', () => {
			const request = Buffer.alloc(9);
			request.writeUInt8(COPY_PROTOCOL_VERSION, 0);
			request.writeBigUInt64BE(blockId, 1);
			socket.end(request);
		});
		socket.on('data', (chunk) => {
			responseBytes += chunk.length;
			if (responseBytes > MAX_COPY_RESPONSE_BYTES + 5) {
				fail(new Error('代码块内容超过 4 MiB。'));
				return;
			}
			chunks.push(chunk);
		});
		socket.once('end', () => {
			if (settled)
				return;
			try {
				const code = parseCodeBlockResponse(Buffer.concat(chunks, responseBytes));
				settled = true;
				resolve(code);
			} catch (error) {
				fail(error);
			}
		});
		socket.once('timeout', () => fail(new Error('连接 Codex CLI 超时。')));
		socket.once('error', (error) => fail(new Error(`无法连接 Codex CLI：${error.message}`)));
	});
}

function parseCodeBlockResponse(response) {
	if (response.length < 1)
		throw new Error('Codex CLI 返回了空响应。');
	if (response[0] === COPY_RESPONSE_NOT_FOUND)
		throw new Error('代码块已经过期，请重新显示后再试。');
	if (response[0] !== COPY_RESPONSE_OK || response.length < 5)
		throw new Error('Codex CLI 返回了无效响应。');

	const contentLength = response.readUInt32BE(1);
	if (contentLength > MAX_COPY_RESPONSE_BYTES)
		throw new Error('代码块内容超过 4 MiB。');
	if (response.length !== contentLength + 5)
		throw new Error('Codex CLI 返回的代码块不完整。');
	return response.subarray(5).toString('utf8');
}

function codeCopySocketPath(session) {
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	if (runtimeDir && path.isAbsolute(runtimeDir))
		return path.join(runtimeDir, 'codex-code-copy', `${session}.sock`);
	if (typeof process.getuid !== 'function')
		throw new Error('代码块复制功能必须运行在 WSL 扩展宿主中。');
	return path.join(os.tmpdir(), `codex-code-copy-${process.getuid()}`, `${session}.sock`);
}

async function smartTerminalPaste() {
	const terminal = vscode.window.activeTerminal;

	if (!terminal)
		return pasteToTerminal();

	try {
		const clipboard = await readWindowsClipboard();

		if (clipboard.kind === 'text') {
			sendClipboardText(terminal, clipboard.text);
			return;
		}
		if (clipboard.kind === 'image') {
			terminal.sendText(ALT_V_SEQUENCE, false);
			return;
		}
	} catch (_error) {
		// Native terminal paste is the safe fallback for text and unsupported hosts.
	}

	return pasteToTerminal();
}

function sendClipboardText(terminal, text) {
	const safeText = text.replace(/[\u0000\u001b]/g, '');

	if (/\r|\n/.test(safeText)) {
		terminal.sendText(
			`${BRACKETED_PASTE_START}${safeText}${BRACKETED_PASTE_END}`,
			false
		);
		return;
	}

	terminal.sendText(safeText, false);
}

function sendSelectedCode(includePrefix) {
	const editor = vscode.window.activeTextEditor;

	if (!editor) {
		vscode.window.showWarningMessage('请先打开代码文件。');
		return;
	}

	const terminal = findCodexTerminal();
	if (!terminal) {
		vscode.window.showWarningMessage(
			'请先打开 Codex CLI 终端，并让它处于活动状态。'
		);
		return;
	}

	const document = editor.document;
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	const relativePath = workspaceFolder
		? path.relative(workspaceFolder.uri.fsPath, document.fileName)
		: document.fileName;
	const content = editor.selection.start.line === editor.selection.end.line
		? `${relativePath.replace(/\\/g, '/')}:${editor.selection.start.line + 1}`
		: document.getText(editor.selection);
	const autoSubmit = vscode.workspace
		.getConfiguration('codex')
		.get('autoSubmit', false);
	const prefix = vscode.workspace
		.getConfiguration('codex')
		.get('prefix', '');
	const message = includePrefix && prefix
		? `${prefix}\n${content}`
		: content;

	terminal.show(false);
	vscode.env.clipboard.writeText(message).then(() =>
		vscode.commands.executeCommand('workbench.action.terminal.paste')
	).then(() => {
		if (autoSubmit)
			terminal.sendText('', true);
	}).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`粘贴代码失败：${message}`);
	});
}

function findCodexTerminal() {
	const codexTerminal = vscode.window.terminals.find((terminal) =>
		isCodexTerminal(terminal)
	);

	return codexTerminal || vscode.window.activeTerminal;
}

function isCodexTerminal(terminal) {
	return terminal.name.toLowerCase().includes('codex');
}

function pasteToTerminal() {
	return vscode.commands.executeCommand('workbench.action.terminal.paste');
}

function readWindowsClipboard() {
	return new Promise((resolve, reject) => {
		childProcess.execFile(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-STA',
				'-Command',
				'Add-Type -AssemblyName System.Windows.Forms; $text = [System.Windows.Forms.Clipboard]::GetText(); if ($text.Length -gt 0) { [Console]::Out.Write("text:"); [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))) } elseif ([System.Windows.Forms.Clipboard]::ContainsImage()) { [Console]::Out.Write("image") } else { [Console]::Out.Write("none") }',
			],
			{
				timeout: POWERSHELL_TIMEOUT_MS,
				windowsHide: true,
				maxBuffer: MAX_CLIPBOARD_OUTPUT_BYTES,
			},
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}

				const output = stdout.trim();

				if (output.startsWith('text:')) {
					resolve({
						kind: 'text',
						text: Buffer.from(output.slice(5), 'base64').toString('utf8'),
					});
					return;
				}

				resolve({ kind: output.toLowerCase(), text: '' });
			}
		);
	});
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
};
