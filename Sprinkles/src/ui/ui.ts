import config, { isTrackIgnored } from "../config";
import { Connection, MessageType } from "../connection";
import Utils from "../utils";
import UIC from "./components";
import { Icons, MergedStyles } from "./ui-assets";
import { Platform, Player, SpotifyUtils } from "../spotify-apis";
import Resources from "../resources";

import { PathTemplate, TemplatedSearchTree } from "../path-template";
import { StatusIndicator } from "./status-indicator";

export default class UI {
    public readonly statusIndicator: StatusIndicator;

    constructor(
        private conn: Connection
    ) {
        this.statusIndicator = new StatusIndicator(conn);

        let style = document.createElement("style");
        style.innerHTML = MergedStyles;
        document.head.appendChild(style);

        this.addTopbarButtons();

        let bodyObs = new MutationObserver(() => {
            let menuList = document.querySelector("#context-menu ul");
            if (menuList !== null && !menuList["_sgf_handled"]) {
                this.onContextMenuOpened(menuList);
            }
        });
        bodyObs.observe(document.body, { childList: true });
    }

    private addTopbarButtons() {
        let fwdButton = document.querySelector("[data-testid='top-bar-forward-button']");
        let topbarContainer = fwdButton.parentElement;
        let buttonClass = fwdButton.classList[0];

        let div = document.createElement("div");
        div.className = "sgf-topbar-retractor";
        div.innerHTML = `
<button class=${buttonClass}>${config.downloaderEnabled ? Icons.FileDownload : Icons.FileDownloadOff}</button>
<button class=${buttonClass}>${Icons.Sliders}</button>`;
        
        //@ts-ignore
        div.children[0].onclick = () => {
            this.updateConfig("downloaderEnabled", !config.downloaderEnabled);
            div.children[0].innerHTML = config.downloaderEnabled ? Icons.FileDownload : Icons.FileDownloadOff;
            //reset track (when enabling), or speed (when disabling)
            SpotifyUtils.resetCurrentTrack(!config.downloaderEnabled && config.playbackSpeed === 1.0);
        };
        //@ts-ignore
        div.children[1].onclick = () => {
            document.body.append(this.createSettingsDialog());
        };
        topbarContainer.append(div);
        return div;
    }

    private async createM3U(uri: string, trackUris?: string[]) {
        let info = await Resources.getTracks(uri);
        let tracks = info.tracks;
        
        let saveResult = await this.conn.request(MessageType.OPEN_FILE_PICKER, {
            type: 2 /* SAVE_FILE */,
            initialPath: config.savePaths.basePath + `/${PathTemplate.escapePath(info.name)}.m3u8`,
            fileTypes: ["M3U Playlist|*.m3u8"]
        });
        let savePath = saveResult.path;
        if (!saveResult.success) return;

        let tree = new TemplatedSearchTree(config.savePaths.track);
        for (let track of tracks) {
            if (trackUris?.length >= 2 && !trackUris.includes(track.uri)) continue;
            tree.add(track.uri, track.vars);
        }

        let statusResp = await this.conn.request(MessageType.DOWNLOAD_STATUS, {
            searchTree: tree.root,
            basePath: config.savePaths.basePath
        });
        let data = `#EXTM3U\n#PLAYLIST:${info.name}\n\n`;
        let numExported = 0;

        for (let track of tracks) {
            let loc = statusResp.results[track.uri];
            if (!loc) continue;
            
            data += `#EXTINF:${(track.durationMs / 1000).toFixed(0)},${track.vars.artist_name} - ${track.vars.track_name}\n`;
            data += `${loc.path}\n\n`;
            numExported++;
        }
        this.conn.send(MessageType.WRITE_FILE, { path: savePath, mode: "replace", text: data });
        this.showNotification(Icons.DoneBig, `Exported ${numExported} tracks`);
    }

    private createSettingsDialog() {
        //TODO: refactor (+ react port?)
        let onChange = this.updateConfig.bind(this);

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
        let extensions = {
            "MP3": "mp3", "M4A": "m4a", "MP4": "mp4",
            "OGG": "ogg", "Opus": "opus"
        };
        let customFormatSection = UIC.subSection(
            UIC.rows("FFmpeg arguments", UIC.textInput("outputFormat.args", onChange)),
            //TODO: allow this to be editable
            UIC.row("Extension", UIC.select("outputFormat.ext", extensions, onChange))
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
            let pickResult = await this.conn.request(MessageType.OPEN_FILE_PICKER, {
                type: 3 /* SELECT_FOLDER */,
                initialPath: config.savePaths.basePath
            });
            basePathTextInput.value = pickResult.path;
            onChange("savePaths.basePath", pickResult.path);
        };

        let pathVarTags = [];
        
        for (let pv of PathTemplate.Vars) {
            let name = `{${pv.name}}`;
            let tag = UIC.tagButton(name, () => {
                Platform.getClipboardAPI().copy(name);
                UIC.notification("Copied", tag, "up", true, 1);
            });
            tag.title = pv.desc;
            pathVarTags.push(tag);
        }

        let canvasPathTxt = UIC.rows("Canvas template", UIC.textInput("savePaths.canvas", onChange));

        let invalidCharModes = {
            "Unicodes": "unicode",
            "Dashes (-)": "-",
            "Underlines (_)": "_",
            "None (remove)": ""
        };

        return UIC.createSettingOverlay(
            UIC.section("General",
                UIC.row("Playback speed",           speedSlider),
                UIC.row("Output format",            UIC.select("outputFormat", Object.getOwnPropertyNames(defaultFormats), onFormatChange)),
                customFormatSection,
                UIC.row("Skip downloaded tracks",   UIC.toggle("skipDownloadedTracks", onChange)),
                UIC.row("Embed cover art",          UIC.toggle("embedCoverArt", onChange)),
                UIC.row("Save cover art in album folder", UIC.toggle("saveCoverArt", onChange)),
                UIC.row("Embed lyrics",             UIC.toggle("embedLyrics", onChange)),
                UIC.row("Save lyrics as .lrc/.txt", UIC.toggle("saveLyrics", onChange)),
                UIC.row("Save canvas",              UIC.toggle("saveCanvas", (k, v) => { 
                    v = onChange(k, v);
                    canvasPathTxt.style.display = v ? "block" : "none";
                    return v;
                }))
            ),
            UIC.section("Paths",
                UIC.rows("Base path",           UIC.colSection(basePathTextInput, UIC.button(null, Icons.Folder, browseBasePath))),
                UIC.rows("Track template",      UIC.textInput("savePaths.track", onChange)),
                UIC.rows("Podcast template",    UIC.textInput("savePaths.episode", onChange)),
                canvasPathTxt,
                UIC.row("Replace invalid characters with", UIC.select("savePaths.invalidCharRepl", invalidCharModes, onChange)),
                UIC.rows(UIC.collapsible("Variables", ...pathVarTags))
            ),
            UIC.section("Misc",
                UIC.row("Block telemetry",      UIC.toggle("blockAds", onChange)),
            )
        );
    }

    public showNotification(icon: string, text: string) {
        let anchor = document.querySelector(".Root__now-playing-bar");

        let node = UIC.parse(`
<div class="sgf-notification-wrapper">
    ${icon}
    <span>${text}</span>
</div>`);
        UIC.notification(node, anchor, "up", false, 3);
    }

    private onContextMenuOpened(menuList: Element) {
        const HookDescs = [
            (contextUri, trackUris) => ({
                text: "Export M3U",
                onClick: () => this.createM3U(contextUri, trackUris)
            }),
            (contextUri, trackUris) => {
                let uris = trackUris?.length > 0 ? trackUris : [contextUri];
                let ignored = uris.some(uri => config.ignorelist[uri]);
                
                return {
                    text: `${ignored ? "Unignore" : "Ignore"} ${uris[0].split(':')[1]}${uris.length > 1 ? "s" : ""}`,
                    onClick: () => {
                        for (let uri of uris) {
                            ignored ? delete config.ignorelist[uri] : config.ignorelist[uri] = 1;
                        }
                        this.conn.send(MessageType.DOWNLOAD_STATUS, {
                            playbackId: Player.getState().playbackId,
                            ignore: isTrackIgnored(Player.getState().item)
                        });
                        this.updateConfig("ignorelist", config.ignorelist);
                    }
                }
            }
        ];

        for (let menuItem of menuList.children) {
            let props = Utils.getReactProps(menuList, menuItem);
            let isTarget = props && (
                (props.contextUri && (props.highlightedUri || props.uris)) ||   //Track: Show credits
                (props.uri && props.hasOwnProperty("onRemoveCallback")) ||      //Album: Add/remove to library
                (props.uri && props.description != null)                        //Playlist: Go to playlist radio
            );
            if (isTarget) {
                let contextUri = props.contextUri ?? props.uri;
                let trackUris = props.highlightedUri ? [props.highlightedUri] : props.uris;

                for (let descFactory of HookDescs) {
                    let desc = descFactory(contextUri, trackUris);
                    let item = menuList.querySelector("li button:not([aria-disabled='true']) span").parentElement.parentElement.cloneNode(true) as HTMLLIElement;
                    item.querySelector("span").innerText = desc.text;
                    item.querySelector("button").classList.remove("QgtQw2NJz7giDZxap2BB"); //separator class
                    item.querySelector("button").onclick = () => {
                        desc.onClick();
                        menuList.parentElement.parentElement["_tippy"]?.props?.onClickOutside();
                    };
                    menuItem.insertAdjacentElement("beforebegin", item);
                }
                menuList["_sgf_handled"] = true; //add mark to prevent this method from being fired multiple times
                break;
            }
        }
    }

    private updateConfig(key: string, newValue?: any) {
        let finalValue = Utils.accessObjectPath(config, key.split('.'), newValue);

        if (newValue !== undefined) {
            let delta = {};
            let field = key.split('.')[0]; //sync only supports topmost field
            delta[field] = config[field];
            this.conn.send(MessageType.SYNC_CONFIG, delta);
        }
        return finalValue;
    }
}
