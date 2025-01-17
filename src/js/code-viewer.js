/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2023-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* globals CodeMirror, uBlockDashboard, beautifier */

'use strict';

/******************************************************************************/

import { dom, qs$ } from './dom.js';
import { getActualTheme } from './theme.js';

/******************************************************************************/

const urlToDocMap = new Map();
const params = new URLSearchParams(document.location.search);
let currentURL = '';

const cmEditor = new CodeMirror(qs$('#content'), {
    autofocus: true,
    gutters: [ 'CodeMirror-linenumbers' ],
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    styleActiveLine: {
        nonEmpty: true,
    },
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

vAPI.messaging.send('dom', { what: 'uiStyles' }).then(response => {
    if ( typeof response !== 'object' || response === null ) { return; }
    if ( getActualTheme(response.uiTheme) === 'dark' ) {
        dom.cl.add('#content .cm-s-default', 'cm-s-night');
        dom.cl.remove('#content .cm-s-default', 'cm-s-default');
    }
});

// Convert resource URLs into clickable links to code viewer
cmEditor.addOverlay({
    re: /\b(?:href|src)=["']([^"']+)["']/g,
    match: null,
    token: function(stream) {
        if ( stream.sol() ) {
            this.re.lastIndex = 0;
            this.match = this.re.exec(stream.string);
        }
        if ( this.match === null ) {
            stream.skipToEnd();
            return null;
        }
        const end = this.re.lastIndex - 1;
        const beg = end - this.match[1].length;
        if ( stream.pos < beg ) {
            stream.pos = beg;
            return null;
        }
        if ( stream.pos < end ) {
            stream.pos = end;
            return 'href';
        }
        if ( stream.pos < this.re.lastIndex ) {
            stream.pos = this.re.lastIndex;
            this.match = this.re.exec(stream.string);
            return null;
        }
        stream.skipToEnd();
        return null;
    },
});

urlToDocMap.set('', cmEditor.getDoc());

/******************************************************************************/

async function fetchResource(url) {
    let response, text;
    try {
        response = await fetch(url);
        text = await response.text();
    } catch(reason) {
        return;
    }
    let mime = response.headers.get('Content-Type') || '';
    mime = mime.replace(/\s*;.*$/, '').trim();
    const options = {
        'end_with_newline': true,
        'indent_size': 2,
        'html': {
            'js': {
                'indent_size': 4,
            },
        },
        'js': {
            'indent_size': 4,
            'preserve-newlines': true,
        },
    };
    switch ( mime ) {
        case 'text/css':
            text = beautifier.css(text, options);
            break;
        case 'text/html':
        case 'application/xhtml+xml':
        case 'application/xml':
        case 'image/svg+xml':
            text = beautifier.html(text, options);
            break;
        case 'text/javascript':
        case 'application/javascript':
        case 'application/x-javascript':
            text = beautifier.js(text, options);
            break;
        case 'application/json':
            text = beautifier.js(text, options);
            break;
        default:
            break;
    }
    return { mime, text };
}

/******************************************************************************/

function addPastURLs(url) {
    const list = qs$('#pastURLs');
    let current;
    for ( let i = 0; i < list.children.length; i++ ) {
        const span = list.children[i];
        dom.cl.remove(span, 'selected');
        if ( span.textContent !== url ) { continue; }
        current = span;
    }
    if ( url === '' ) { return; }
    if ( current === undefined ) {
        current = document.createElement('span');
        current.textContent = url;
        list.prepend(current);
    }
    dom.cl.add(current, 'selected');
}

/******************************************************************************/

function setInputURL(url) {
    const input = qs$('#header input[type="url"]');
    if ( url === input.value ) { return; }
    dom.attr(input, 'value', url);
    input.value = url;
}

/******************************************************************************/

async function setURL(resourceURL) {
    // For convenience, remove potentially existing quotes around the URL
    if ( /^(["']).+\1$/.test(resourceURL) ) {
        resourceURL = resourceURL.slice(1, -1);
    }
    let afterURL;
    if ( resourceURL !== '' ) {
        try {
            const url = new URL(resourceURL, currentURL || undefined);
            url.hash = '';
            afterURL = url.href;
        } catch(ex) {
        }
        if ( afterURL === undefined ) { return; }
    } else {
        afterURL = '';
    }
    if ( afterURL !== '' && /^https?:\/\/./.test(afterURL) === false ) {
        return;
    }
    if ( afterURL === currentURL ) {
        if ( afterURL !== resourceURL ) {
            setInputURL(afterURL);
        }
        return;
    }
    let afterDoc = urlToDocMap.get(afterURL);
    if ( afterDoc === undefined ) {
        const r = await fetchResource(afterURL) || { mime: '', text: '' };
        afterDoc = new CodeMirror.Doc(r.text, r.mime || '');
    }
    urlToDocMap.set(currentURL, cmEditor.swapDoc(afterDoc));
    currentURL = afterURL;
    setInputURL(afterURL);
    const a = qs$('.cm-search-widget .sourceURL');
    dom.attr(a, 'href', afterURL);
    dom.attr(a, 'title', afterURL);
    addPastURLs(afterURL);
    // For unknown reasons, calling focus() synchronously does not work...
    vAPI.setTimeout(( ) => { cmEditor.focus(); }, 1);
}

/******************************************************************************/

function removeURL(url) {
    if ( url === '' ) { return; }
    const list = qs$('#pastURLs');
    let foundAt = -1;
    for ( let i = 0; i < list.children.length; i++ ) {
        const span = list.children[i];
        if ( span.textContent !== url ) { continue; }
        foundAt = i;
    }
    if ( foundAt === -1 ) { return; }
    list.children[foundAt].remove();
    if ( foundAt >= list.children.length ) {
        foundAt = list.children.length - 1;
    }
    const afterURL = foundAt !== -1
        ? list.children[foundAt].textContent
        : '';
    setURL(afterURL);
    urlToDocMap.delete(url);
}

/******************************************************************************/

setURL(params.get('url'));

dom.on('#header input[type="url"]', 'change', ev => {
    setURL(ev.target.value);
});

dom.on('#removeURL', 'click', ( ) => {
    removeURL(qs$('#header input[type="url"]').value);
});

dom.on('#pastURLs', 'mousedown', 'span', ev => {
    setURL(ev.target.textContent);
});

dom.on('#content', 'click', '.cm-href', ev => {
    setURL(ev.target.textContent);
});
