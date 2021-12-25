import config from "../config";
import { Connection, MessageType } from "../connection";
import Utils from "../utils";
import UIC from "./components";
import { Platform, SpotifyUtils } from "../spotify-apis";

import ComponentsStyle from "./css/components.css";
import SettingsStyle from "./css/settings.css";
import StatusIndicatorStyle from "./css/status-indicator.css";
import { PathTemplate, TemplatedSearchTree } from "../path-template";
import Resources from "../resources";

const MergedStyles = [ComponentsStyle, SettingsStyle, StatusIndicatorStyle].join('\n'); //TODO: find a better way to do this

const Icons = {
    Apps: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>`,
    Album: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>`,
    List: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>`,
    MagicWand: `<svg width="24" height="24" viewBox="-2 -2 28 28" fill="currentColor"><path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.03 5.49l-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z"></path></svg>`,
    Folder: `<svg width="24px" height="24px" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path></svg>`,
    Sliders: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"></path></svg>`
};

export default class UI
{
    private _styleElement: HTMLStyleElement;
    private _settingsButton: HTMLButtonElement;
    private _conn: Connection;

    private _bodyObs: MutationObserver;
    private _ctxMenuHooks: ContextMenuItemFactory[] = [];

    constructor(conn: Connection)
    {
        this._conn = conn;
        this._styleElement = document.createElement("style");
        this._styleElement.innerHTML = MergedStyles;

        this._bodyObs = new MutationObserver(this.onDocBodyChanged.bind(this));
        this._bodyObs.observe(document.body, { childList: true });
    }

    install()
    {
        document.head.appendChild(this._styleElement);
        this._settingsButton = UIC.addTopbarButton(
            "Soggfy",
            //TODO: design a icon for this
            //https://fonts.google.com/icons?selected=Material+Icons:settings&icon.query=down
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M18,15v3H6v-3H4v3c0,1.1,0.9,2,2,2h12c1.1,0,2-0.9,2-2v-3H18z M17,11l-1.41-1.41L13,12.17V4h-2v8.17L8.41,9.59L7,11l5,5 L17,11z"></path></svg>`,
            () => document.body.append(this.createSettingsDialog())
        );
        this.addContextMenuHook(menuList => {
            for (let item of menuList.children) {
                let props = Utils.getReactProps(menuList, item);
                let isTarget = props && (
                    (props.contextUri && props.highlightedUri) ||               //Track: Show credits
                    (props.uri && props.hasOwnProperty("onRemoveCallback")) ||  //Album: Add/remove to library
                    (props.uri && props.isPublished != null)                    //Playlist: Add/remove to profile
                );
                if (isTarget) {
                    let uri = props.contextUri ?? props.uri;
                    return {
                        text: "Export M3U",
                        location: item as HTMLLIElement,
                        locationOffset: "beforebegin",
                        onClick: () => this.createM3U(uri)
                    };
                }
            }
        });
    }
    setEnabled(enabled: boolean)
    {
        this._settingsButton.disabled = !enabled;
    }

    private async createM3U(uri: string)
    {
        let info = await PathTemplate.getTracks(uri);
        let tracks = info.tracks;
        
        let saveResult = await this._conn.request(MessageType.OPEN_FILE_PICKER, {
            type: 2 /* SAVE_FILE */,
            initialPath: config.savePaths.basePath + `/${PathTemplate.escapePath(info.name)}.m3u8`,
            fileTypes: [ "M3U Playlist|*.m3u8" ]
        }, null, -1);
        let savePath = saveResult.payload.path;
        if (!saveResult.payload.success) return;

        let tree = new TemplatedSearchTree(config.savePaths.track);
        for (let track of tracks) {
            tree.add(track.uri, track.vars);
        }

        let data = await this._conn.request(MessageType.DOWNLOAD_STATUS, {
            searchTree: tree.root,
            basePath: config.savePaths.basePath,
            relativeTo: savePath
        });
        let results = data.payload.results;
        let plData = `#EXTM3U\n#PLAYLIST:${info.name}\n\n`;

        for (let track of tracks) {
            let loc = results[track.uri];
            if (!loc) continue;
            plData += `#EXTINF:${(track.durationMs / 1000).toFixed(0)},${track.vars.artist_name} - ${track.vars.track_name}\n`;
            plData += `${loc.path}\n\n`;
        }
        await this._conn.request(MessageType.WRITE_FILE, { path: savePath, textData: plData })
    }

    private createSettingsDialog()
    {
        //TODO: refactor
        let onChange = this.configAccessor.bind(this);

        let speedSlider = UIC.slider(
            "playbackSpeed",
            { min: 1, max: 20, step: 1, formatter: val => val + "x" },
            (key, newValue) => {
                if (newValue) {
                    SpotifyUtils.resetCurrentTrack(false);
                }
                return onChange(key, newValue);
            }
        );
        let defaultFormats = {
            "Original OGG":     { ext: "",    args: "-c copy" },
            "MP3 320K":         { ext: "mp3", args: "-c:a libmp3lame -b:a 320k -id3v2_version 3 -c:v copy" },
            "MP3 256K":         { ext: "mp3", args: "-c:a libmp3lame -b:a 256k -id3v2_version 3 -c:v copy" },
            "MP3 192K":         { ext: "mp3", args: "-c:a libmp3lame -b:a 192k -id3v2_version 3 -c:v copy" },
            "M4A 256K (AAC)":   { ext: "m4a", args: "-c:a aac -b:a 256k -disposition:v attached_pic -c:v copy" }, //TODO: aac quality disclaimer / libfdk
            "M4A 192K (AAC)":   { ext: "m4a", args: "-c:a aac -b:a 192k -disposition:v attached_pic -c:v copy" },
            "Opus 160K":        { ext: "opus",args: "-c:a libopus -b:a 160k" },
            "Custom":           { ext: "mp3", args: "-c:a libmp3lame -b:a 320k -id3v2_version 3 -c:v copy" },
        };
        let customFormatSection = UIC.subSection(
            UIC.rows("FFmpeg arguments", UIC.textInput("outputFormat.args", onChange)),
            //TODO: allow this to be editable
            UIC.row("Extension", UIC.select("outputFormat.ext", ["mp3", "m4a", "mp4", "ogg", "opus"], onChange))
        );
        customFormatSection.style.display = "none";
        
        let onFormatChange = (key: string, name?: string) => {
            if (name === undefined) {
                let currFormat = config.outputFormat;
                let preset =
                    Object.entries(defaultFormats)
                        .find(v => v[1].args === currFormat.args && v[1].ext === currFormat.ext);
                name = preset?.[0] ?? "Custom";
            } else {
                onChange("outputFormat", defaultFormats[name]);
            }
            customFormatSection.style.display = name === "Custom" ? "block" : "none";
            return name;
        };

        let basePathTextInput = UIC.textInput("savePaths.basePath", onChange);
        let browseBasePath = async () => {
            let resp = await this._conn.request(MessageType.OPEN_FILE_PICKER, {
                type: 3 /* SELECT_FOLDER */,
                initialPath: config.savePaths.basePath
            }, null, -1);
            basePathTextInput.value = resp.payload.path;
            onChange("savePaths.basePath", resp.payload.path);
        };

        let pathVarTags = [];
        
        for (let pv of PathTemplate.Vars) {
            let name = `{${pv.name}}`;
            let tag = UIC.tagButton(name, () => {
                Platform.getClipboardAPI().copy(name);
                UIC.notification("Copied", tag, 1);
            });
            tag.title = pv.desc;
            pathVarTags.push(tag);
        }

        return UIC.createSettingOverlay(
            UIC.section("General",
                UIC.row("Playback speed",       speedSlider),
                UIC.row("Output format",        UIC.select("outputFormat", Object.getOwnPropertyNames(defaultFormats), onFormatChange)),
                customFormatSection,
                UIC.row("Embed cover art",      UIC.toggle("embedCoverArt", onChange)),
                UIC.row("Save cover art in album folder", UIC.toggle("saveCoverArt", onChange)),
                UIC.row("Embed lyrics",         UIC.toggle("embedLyrics", onChange)),
                UIC.row("Save lyrics as .lrc/.txt", UIC.toggle("saveLyrics", onChange))
            ),
            UIC.section("Paths",
                UIC.rows("Base Path",           UIC.colSection(basePathTextInput, UIC.button(null, Icons.Folder, browseBasePath))),
                UIC.rows("Track template",      UIC.textInput("savePaths.track", onChange)),
                UIC.rows("Podcast template",    UIC.textInput("savePaths.episode", onChange)),
                UIC.rows(UIC.collapsible("Variables", ...pathVarTags))
            )
        );
    }

    private onDocBodyChanged(records: MutationRecord[])
    {
        for (let record of records) {
            for (let node of record.addedNodes) {
                let elem = node as HTMLElement;

                if (elem.querySelector("#context-menu")) {
                    if (elem.querySelector("ul")) {
                        this.onContextMenuOpened(elem);
                    } else {
                        //the ... popup has a delay before being populated
                        let obs = new MutationObserver(() => {
                            this.onContextMenuOpened(elem);
                            obs.disconnect();
                        });
                        obs.observe(elem, { childList: true, subtree: true });
                    }
                }
            }
        }
    }

    public addContextMenuHook(itemFactory: ContextMenuItemFactory)
    {
        this._ctxMenuHooks.push(itemFactory);
    }
    private onContextMenuOpened(popdiv: HTMLElement)
    {
        let list = popdiv.querySelector("ul");

        for (let factory of this._ctxMenuHooks) {
            let desc = factory(list);
            if (!desc) continue;

            let itemTemplate = list.querySelector("li button[aria-disabled='false'] span").parentElement.parentElement;
            let item = itemTemplate.cloneNode(true) as HTMLLIElement;
            item.querySelector("span").innerText = desc.text;
            item.querySelector("button").onclick = () => {
                desc.onClick();
                popdiv["_tippy"]?.props?.onClickOutside(); //based on Spicetify code
            };
            if (!list.contains(desc.location)) throw Error("Location must be inside list");
            desc.location.insertAdjacentElement(desc.locationOffset ?? "afterend", item);
        }
    }

    private configAccessor(key: string, newValue?: any)
    {
        let finalValue = Utils.accessObjectPath(config, key.split('.'), newValue);

        if (newValue !== undefined) {
            let delta = {};
            let field = key.split('.')[0]; //sync only supports topmost field
            delta[field] = config[field];
            this._conn.send(MessageType.SYNC_CONFIG, delta);
        }
        return finalValue;
    }
}

type ContextMenuItemFactory = (menuList: HTMLUListElement) => ContextMenuItemDesc | null;
interface ContextMenuItemDesc
{
    text: string;
    location?: HTMLLIElement;
    locationOffset?: "beforebegin" | "afterend";

    onClick: () => void;
}

/**
 * Extracts the specified CSS selectors from xpui.js.
 * Note: This function is expansive and results should be cached.
 */
async function extractSelectors(...names: string[])
{
    let pattern = `(${names.join('|')}):\\s*"(.+?)"`;
    let regex = new RegExp(pattern, "g");
    let results: any = {};

    let req = await fetch("/xpui.js");
    let js = await req.text();

    let match: RegExpExecArray;
    while (match = regex.exec(js)) {
        let key = match[1];
        let val = match[2];
        results[key] = "." + val;
    }
    return results;
}

let selectors = await extractSelectors(
    "trackListRow", "rowTitle", "rowSubTitle", "rowSectionEnd",
    "rowMoreButton"
);

export {
    selectors as Selectors
}