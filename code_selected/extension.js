const vscode = require('vscode');
const claude = require('./claude');
const codex = require('./codex');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'easyClaude.sendSelectedCode',
			() => claude.sendSelectedCode(true)
		),
		vscode.commands.registerCommand(
			'easyClaude.sendSelectedCodeWithoutPrefix',
			() => claude.sendSelectedCode(false)
		),
		vscode.commands.registerCommand(
			'codex.sendSelectedCode',
			() => codex.sendSelectedCode(true)
		),
		vscode.commands.registerCommand(
			'codex.sendSelectedCodeWithoutPrefix',
			() => codex.sendSelectedCode(false)
		),
		vscode.commands.registerCommand(
			'codex.smartTerminalPaste',
			() => smartTerminalPaste()
		),
		vscode.window.registerUriHandler({
			handleUri: (uri) => codex.handleCodeBlockCopyUri(uri),
		})
	);
}

function smartTerminalPaste() {
	// User keybindings ignore the contributed when clause, so check the mode here too.
	if (vscode.workspace.getConfiguration('codeSelected').get('cli', 'claude') !== 'codex')
		return vscode.commands.executeCommand('workbench.action.terminal.paste');

	return codex.smartTerminalPaste();
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
};
