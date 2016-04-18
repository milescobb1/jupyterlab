// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  getWsUrl
} from 'jupyter-js-utils';

import {
  IBoxSizing, boxSizing
} from 'phosphor-domutil';

import {
  Message, sendMessage
} from 'phosphor-messaging';

import {
  ResizeMessage, Widget
} from 'phosphor-widget';

import {
  Terminal, ITerminalConfig
} from 'term.js';


/**
 * The class name added to a terminal widget.
 */
const TERMINAL_CLASS = 'jp-TerminalWidget';

/**
 * The class name added to a terminal body.
 */
const TERMINAL_BODY_CLASS = 'jp-TerminalWidget-body';

/**
 * The number of rows to use in the dummy terminal.
 */
const DUMMY_ROWS = 24;

/**
 * The number of cols to use in the dummy terminal.
 */
const DUMMY_COLS = 80;

/**
 * Options for the terminal widget.
 */
export
interface ITerminalOptions {
  /**
   * The base websocket url.
   */
  baseUrl?: string;

  /**
   * The font size of the terminal in pixels.
   */
  fontSize?: number;

  /**
   * The background color of the terminal.
   */
  background?: string;

  /**
   * The text color of the terminal.
   */
  color?: string;

  /**
   * Whether to blink the cursor.  Can only be set at startup.
   */
  cursorBlink?: boolean;

  /**
   * Whether to show a bell in the terminal.
   */
  visualBell?: boolean;

  /**
   * Whether to focus on a bell event.
   */
  popOnBell?: boolean;

  /**
   * The size of the scrollback buffer in the terminal.
   */
  scrollback?: number;
}


/**
 * A widget which manages a terminal session.
 */
export
class TerminalWidget extends Widget {

  /**
   * The number of terminals started.  Used to ensure unique sessions.
   */
  static nterms = 0;

  /**
   * Construct a new terminal widget.
   *
   * @param options - The terminal configuration options.
   */
  constructor(options?: ITerminalOptions) {
    super();
    options = options || {};
    this.addClass(TERMINAL_CLASS);
    let baseUrl = options.baseUrl || getWsUrl();

    TerminalWidget.nterms += 1;
    let url = baseUrl + 'terminals/websocket/' + TerminalWidget.nterms;
    this._ws = new WebSocket(url);
    this.id = `jp-TerminalWidget-${TerminalWidget.nterms}`;

    // Set the default title.
    this.title.text = 'Terminal ' + TerminalWidget.nterms;

    Terminal.brokenBold = true;

    this._dummyTerm = createDummyTerm();

    this._ws.onopen = (event: MessageEvent) => {
      this._createTerm(options);
    };

    this._ws.onmessage = (event: MessageEvent) => {
      this._handleWSMessage(event);
    };

    this._sheet = document.createElement('style');
    this.node.appendChild(this._sheet);
  }

  /**
   * Get the font size of the terminal in pixels.
   */
  get fontSize(): number {
    return this._fontSize;
  }

  /**
   * Set the font size of the terminal in pixels.
   */
  set fontSize(size: number) {
    this._fontSize = size;
    this._term.element.style.fontSize = `${size}px`;
    this._snapTermSizing();
  }

  /**
   * Get the background color of the terminal.
   */
  get background(): string {
    return this._background;
  }

  /**
   * Set the background color of the terminal.
   */
  set background(value: string) {
    this._background = value;
    this.update();
  }

  /**
   * Get the text color of the terminal.
   */
  get color(): string {
    return this._color;
  }

  /**
   * Set the text color of the terminal.
   */
  set color(value: string) {
    this._color = value;
    this.update();
  }

  /**
   * Get whether the bell is shown.
   */
  get visualBell(): boolean {
    return this._term.visualBell;
  }

  /**
   * Set whether the bell is shown.
   */
  set visualBell(value: boolean) {
    this._term.visualBell = value;
  }

  /**
   * Get whether to focus on a bell event.
   */
  get popOnBell(): boolean {
    return this._term.popOnBell;
  }

  /**
   * Set whether to focus on a bell event.
   */
  set popOnBell(value: boolean) {
    this._term.popOnBell = value;
  }

  /**
   * Get the size of the scrollback buffer in the terminal.
   */
  get scrollback(): number {
    return this._term.scrollback;
  }

  /**
   * Set the size of the scrollback buffer in the terminal.
   */
  set scrollback(value: number) {
    this._term.scrollback = value;
  }

  /**
   * Dispose of the resources held by the terminal widget.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._ws.close();
    this._term.destroy();
    this._sheet = null;
    this._ws = null;
    this._term = null;
    this._dummyTerm = null;
    super.dispose();
  }

  /**
   * Process a message sent to the widget.
   *
   * @param msg - The message sent to the widget.
   *
   * #### Notes
   * Subclasses may reimplement this method as needed.
   */
  processMessage(msg: Message): void {
    super.processMessage(msg);
    switch (msg.type) {
      case 'fit-request':
        this.onFitRequest(msg);
        break;
    }
  }

  /**
   * Set the size of the terminal when attached if dirty.
   */
  protected onAfterAttach(msg: Message): void {
    if (this._dirty) {
      this._snapTermSizing();
    }
  }

  /**
   * Set the size of the terminal when shown if dirty.
   */
  protected onAfterShow(msg: Message): void {
    if (this._dirty) {
      this._snapTermSizing();
    }
  }

  /**
   * Dispose of the terminal when closing.
   */
  protected onCloseRequest(msg: Message): void {
    super.onCloseRequest(msg);
    this.dispose();
  }

  /**
   * On resize, use the computed row and column sizes to resize the terminal.
   */
  protected onResize(msg: ResizeMessage): void {
    if (!this.isAttached || !this.isVisible) {
      return;
    }
    let width = msg.width;
    let height = msg.height;
    if (width < 0 || height < 0) {
      let rect = this.node.getBoundingClientRect();
      if (width < 0) width = rect.width;
      if (height < 0) height = rect.height;
    }
    this._width = width;
    this._height = height;
    this._resizeTerminal();
  }

  /**
   * A message handler invoked on an `'update-request'` message.
   */
  protected onUpdateRequest(msg: Message): void {
    // Set the fg and bg colors of the terminal and cursor.
    this.node.style.backgroundColor = this.background;
    this.node.style.color = this.color;
    this._term.element.style.backgroundColor = this.background;
    this._term.element.style.color = this.color;
    this._sheet.innerHTML = ('.terminal-cursor {background:' + this.color +
                             ';color:' + this.background + ';}');
  }

  /**
   * A message handler invoked on an `'fit-request'` message.
   */
  protected onFitRequest(msg: Message): void {
    let resize = ResizeMessage.UnknownSize;
    sendMessage(this, resize);
  }

  /**
   * Create the terminal object.
   */
  private _createTerm(options: ITerminalOptions): void {
    this._term = new Terminal(getConfig(options));
    this._term.open(this.node);
    this._term.element.classList.add(TERMINAL_BODY_CLASS);

    this.fontSize = options.fontSize || 11;
    this.background = options.background || 'white';
    this.color = options.color || 'black';

    this._term.on('data', (data: string) => {
      this._ws.send(JSON.stringify(['stdin', data]));
    });

    this._term.on('title', (title: string) => {
        this.title.text = title;
    });
    this._resizeTerminal();
  }

  /**
   * Handle a message from the terminal websocket.
   */
  private _handleWSMessage(event: MessageEvent): void {
    let json_msg = JSON.parse(event.data);
    switch (json_msg[0]) {
    case 'stdout':
      this._term.write(json_msg[1]);
      break;
    case 'disconnect':
      this._term.write('\r\n\r\n[Finished... Term Session]\r\n');
      break;
    }
  }

  /**
   * Use the dummy terminal to measure the row and column sizes.
   */
  private _snapTermSizing(): void {
    if (!this.isAttached || !this.isVisible) {
      this._dirty = true;
      return;
    }
    let node = this._dummyTerm;
    this._term.element.appendChild(node);
    this._rowHeight = node.offsetHeight / DUMMY_ROWS;
    this._colWidth = node.offsetWidth / DUMMY_COLS;
    this._term.element.removeChild(node);
    this._dirty = false;
    if (this._width !== -1) {
      this._resizeTerminal();
    }
  }

  /**
   * Resize the terminal based on the computed geometry.
   */
  private _resizeTerminal() {
    if (this._term === null) {
      return;
    }
    let box = this._box || boxSizing(this.node);
    let height = this._height - box.verticalSum;
    let width = this._width - box.horizontalSum;
    let rows = Math.floor(height / this._rowHeight) - 1;
    let cols = Math.floor(width / this._colWidth) - 1;
    this._term.resize(cols, rows);
    this._ws.send(JSON.stringify(['set_size', rows, cols,
                                this._height, this._width]));
  }

  private _term: Terminal = null;
  private _ws: WebSocket = null;
  private _rowHeight = -1;
  private _colWidth = -1;
  private _sheet: HTMLElement = null;
  private _dummyTerm: HTMLElement = null;
  private _fontSize = -1;
  private _dirty = false;
  private _width = -1;
  private _height = -1;
  private _background = '';
  private _color = '';
  private _box: IBoxSizing = null;
}


/**
 * Get term.js options from ITerminalOptions.
 */
function getConfig(options: ITerminalOptions): ITerminalConfig {
  let config: ITerminalConfig = {};
  if (options.cursorBlink !== void 0) {
    config.cursorBlink = options.cursorBlink;
  }
  if (options.visualBell !== void 0) {
    config.visualBell = options.visualBell;
  }
  if (options.popOnBell !== void 0) {
    config.popOnBell = options.popOnBell;
  }
  if (options.scrollback !== void 0) {
    config.scrollback = options.scrollback;
  }
  config.screenKeys = false;
  return config;
}


/**
 * Create a dummy terminal element used to measure text size.
 */
function createDummyTerm(): HTMLElement {
  let node = document.createElement('div');
  let rowspan = document.createElement('span');
  rowspan.innerHTML = Array(DUMMY_ROWS).join('a<br>');
  let colspan = document.createElement('span');
  colspan.textContent = Array(DUMMY_COLS + 1).join('a');
  node.appendChild(rowspan);
  node.appendChild(colspan);
  node.style.visibility = 'hidden';
  node.style.position = 'absolute';
  node.style.height = 'auto';
  node.style.width = 'auto';
  (node.style as any)['white-space'] = 'nowrap';
  return node;
}
