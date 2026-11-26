'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('ws', {
  importDialog: inv('import:dialog'),
  importPaths: inv('import:paths'),
  importClipboard: inv('import:clipboard'),
  importAudioDialog: inv('import:audio-dialog'),
  importAudioPath: inv('import:audio-path'),
  importUrl: inv('import:url'),
  cancelUrl: inv('import:url-cancel'),
  ytdlpStatus: inv('ytdlp:status'),
  ytdlpInstall: inv('ytdlp:install'),
  preview: inv('media:preview'),
  mediaUrl: inv('media:url'),
  thumbnails: inv('media:thumbnails'),
  waveform: inv('media:waveform'),
  defaults: inv('project:defaults'),
  render: inv('render'),
  exportSticker: inv('export'),
  reveal: inv('reveal'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  library: {
    list: inv('library:list'), save: inv('library:save'), rename: inv('library:rename'), favorite: inv('library:favorite'),
    remove: inv('library:remove'), open: inv('library:open'), exportItem: inv('library:export'), reveal: inv('library:reveal'),
  },
  settings: {
    get: inv('settings:get'), set: inv('settings:set'), chooseLibraryDir: inv('settings:library-dir'), openLibrary: inv('settings:open-library'),
    ytdlpVersion: inv('ytdlp:version'), ytdlpUpdate: inv('ytdlp:update'), ytdlpRemove: inv('ytdlp:remove'),
  },
  wa: {
    status: inv('wa:status'), connect: inv('wa:connect'), unlink: inv('wa:unlink'), send: inv('wa:send'),
    onStatus: (fn) => { const h = (e, d) => fn(d); ipcRenderer.on('wa-status', h); return () => ipcRenderer.off('wa-status', h); },
  },
  onProgress: (fn) => { const h = (e, d) => fn(d); ipcRenderer.on('progress', h); return () => ipcRenderer.off('progress', h); },
});
