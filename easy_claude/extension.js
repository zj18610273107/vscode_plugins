const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';
const CLAUDE_PROCESS_NAME = 'claude';
const MAX_PROCESS_DEPTH = 3;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	const sendWithPrefixCommand = vscode.commands.registerCommand(
		'easyClaude.sendSelectedCode',
		() => sendSelectedCode(true)
	);
	const sendWithoutPrefixCommand = vscode.commands.registerCommand(
		'easyClaude.sendSelectedCodeWithoutPrefix',
		() => sendSelectedCode(false)
	);

	context.subscriptions.push(sendWithPrefixCommand, sendWithoutPrefixCommand);
}

async function sendSelectedCode(includePrefix) {
	const editor = vscode.window.activeTextEditor;

	if (!editor) {
		vscode.window.showWarningMessage('请先打开代码文件。');
		return;
	}

	const terminal = await findClaudeTerminal();
	if (!terminal) {
		vscode.window.showWarningMessage(
			'没有找到运行 claude 的终端，请先在集成终端中启动 Claude CLI。'
		);
		return;
	}

	const config = vscode.workspace.getConfiguration('easyClaude');
	const prefix = config.get('prefix', '');
	const content = selectionLocation(editor);
	const message = includePrefix && prefix
		? `${prefix}\n${content}`
		: content;

	terminal.show(false);
	pasteToTerminal(terminal, message);
	if (config.get('autoSubmit', false))
		terminal.sendText('', true);
}

function selectionLocation(editor) {
	const document = editor.document;
	const selection = editor.selection;
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	const relativePath = workspaceFolder
		? path.relative(workspaceFolder.uri.fsPath, document.fileName)
		: document.fileName;
	const startLine = selection.start.line + 1;
	// A selection ending at column 0 does not include that line.
	const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
		? selection.end.line
		: selection.end.line + 1;
	const lines = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

	return `@${relativePath.replace(/\\/g, '/')}#L${lines} `;
}

function pasteToTerminal(terminal, text) {
	// Same line endings as xterm.js paste; ESC is dropped so the text cannot end the paste early.
	const safeText = text.replace(/[\u0000\u001b]/g, '').replace(/\r?\n/g, '\r');

	terminal.sendText(
		`${BRACKETED_PASTE_START}${safeText}${BRACKETED_PASTE_END}`,
		false
	);
}

async function findClaudeTerminal() {
	const active = vscode.window.activeTerminal;
	const terminals = active
		? [active, ...vscode.window.terminals.filter((terminal) => terminal !== active)]
		: vscode.window.terminals;

	for (const terminal of terminals) {
		const pid = await terminal.processId;

		if (pid && hasClaudeProcess(pid, MAX_PROCESS_DEPTH))
			return terminal;
	}

	return terminals.find((terminal) =>
		terminal.name.toLowerCase().includes(CLAUDE_PROCESS_NAME)
	);
}

function hasClaudeProcess(pid, depth) {
	if (processName(pid) === CLAUDE_PROCESS_NAME)
		return true;
	if (depth === 0)
		return false;

	return childPids(pid).some((child) => hasClaudeProcess(child, depth - 1));
}

function childPids(pid) {
	try {
		return fs.readdirSync(`/proc/${pid}/task`).flatMap((tid) =>
			fs.readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8')
				.split(' ')
				.filter(Boolean)
		);
	} catch (_error) {
		return [];
	}
}

function processName(pid) {
	try {
		return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
	} catch (_error) {
		return '';
	}
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
};
