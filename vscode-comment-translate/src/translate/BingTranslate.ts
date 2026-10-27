import { BaseTranslate } from "./baseTranslate";
import {
    ITranslateOptions,
    encodeMarkdownUriComponent,
} from "comment-translate-manager";
const { translate } = require("bing-translate-api");

//免费API https://github.com/Selection-Translator/translation.js/tree/master/src
export class BingTranslate extends BaseTranslate {
    override readonly maxLen = 1000;
    async _translate(
        content: string,
        { from = "auto", to = "auto" }: ITranslateOptions
    ): Promise<string> {
        const request = () => translate(content, this._langMap(from), this._langMap(to));
        let res;
        try {
            res = await request();
        } catch (e) {
            // bing-translate-api throws a TypeError when the request gets no
            // response at all, e.g. a failed TLS handshake. Retry once.
            if (!(e instanceof TypeError)) throw e;
            res = await request();
        }
        // console.log(res);
        return res.translation;
    }

    _langMap(src: string) {
        let langMaps: Map<string, string> = new Map([
            ["auto", "auto-detect"],
            ["zh-CN", "zh-Hans"],
            ["zh-TW", "zh-Hant"],
        ]);

        if (langMaps.has(src)) {
            return langMaps.get(src);
        }
        return src;
    }

    link(
        content: string,
        { to = "auto", from = "auto" }: ITranslateOptions
    ): string {
        // [fix] 参数变化zh-cn -> zh-CN。
        // let [first, last] = to.split('-');
        // if (last) {
        //     last = last.toLocaleUpperCase();
        //     to = `${first}-${last}`;
        // }

        // https://cn.bing.com/translator/?ref=TThis&text=good&from=en&to=es
        let str = `https://www.bing.com/translator/?text=${encodeMarkdownUriComponent(
            content
        )}&from=${this._langMap(from)}&to=${this._langMap(to)}`;
        return `[Bing](${str})`;
    }
}
