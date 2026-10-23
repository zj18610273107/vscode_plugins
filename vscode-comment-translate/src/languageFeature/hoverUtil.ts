import { MarkdownString, Range, TextDocument } from "vscode";
import { getConfig } from "../configuration";

// Continuation lines carry the source indentation while the first line does
// not (the range starts at "/*", or the translator trims it). Strip the common
// indentation of the source lines, so " * " lines stay aligned under "/*".
function alignIndent(text: string, range: Range, document: TextDocument): string {
    const indent = document.lineAt(range.start.line).text.slice(0, range.start.character);
    if (!text.includes("\n") || indent.trim()) return text;

    let common: string | undefined;
    for (const line of (indent + document.getText(range)).split("\n")) {
        if (!line.trim()) continue;
        const lead = line.slice(0, line.length - line.trimStart().length);
        if (common === undefined) common = lead;
        while (!lead.startsWith(common)) common = common.slice(0, -1);
    }
    const prefix = common ?? "";
    if (!prefix) return text;
    return text.split("\n").map(line => line.startsWith(prefix) ? line.slice(prefix.length) : line).join("\n");
}

export function createTranslationMarkdown(
    translatedText: string,
    languageId: string
): MarkdownString {
    const md = new MarkdownString();
    md.appendCodeblock(translatedText.replace(/\r\n/g, "\n"), languageId);
    return md;
}

export function createHoverMarkdownString(
    translatedText: string,
    humanizeText: string | undefined,
    uri: string,
    range: Range,
    document: TextDocument,
    translateLink: string
): { md: MarkdownString, header: MarkdownString } {
    const base64TranslatedText = Buffer.from(translatedText).toString("base64");
    const space = "&nbsp;&nbsp;";
    const separator = `${space}|${space}`;
    const replace = `[$(replace)](command:commentTranslate._replaceRange?${encodeURIComponent(
        JSON.stringify({
            uri,
            range: { start: range.start, end: range.end },
            text: base64TranslatedText,
        })
    )} "Replace")`;
    const multiLine = getConfig<boolean>("multiLineMerge");
    const combine = `[$(${multiLine ? "selection" : "remove"
        })](command:commentTranslate._toggleMultiLineMerge "Toggle Combine Multi Line")`;

    // bugfix: JSON.stringify Range会变成数组。 传到下游会有问题。
    const addSelection = `[$(heart)](command:commentTranslate._addSelection?${encodeURIComponent(
        JSON.stringify({ range: { start: range.start, end: range.end } })
    )} "Add Selection")`;

    const translate = `[$(sync)](command:commentTranslate.changeTranslateSource "Change translate source")`;

    const header = new MarkdownString(
        `[Comment Translate]${space}${replace}${space}${combine}${space}${addSelection}${separator}${translate}${space}${translateLink}`,
        true
    );
    header.isTrusted = true;

    let showText = alignIndent(translatedText, range, document);
    if (humanizeText) {
        showText = `${humanizeText} => ${showText}`;
    }
    let md = createTranslationMarkdown(showText, document.languageId);
    if (!translatedText) {
        md = new MarkdownString(
            `**Translate Error**: Check [OutputPannel](command:commentTranslate._openOutputPannel "open output pannel") for details.`
        );
        md.isTrusted = true;
    }

    return { header, md };
}
