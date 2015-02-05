
goog.provide('ol.MapBrowserEventHandler');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.events');
goog.require('goog.events.BrowserEvent');
goog.require('goog.events.EventTarget');
goog.require('goog.events.EventType');
goog.require('goog.object');
goog.require('ol');
goog.require('ol.Coordinate');
goog.require('ol.MapEvent');
goog.require('ol.Pixel');
goog.require('ol.pointer.PointerEvent');
goog.require('ol.pointer.PointerEventHandler');
goog.require('ol.MapBrowserEvent.EventType');
goog.require('ol.MapBrowserPointerEvent');

/**
 * @param {ol.Map} map The map with the viewport to listen to events on.
 * @constructor
 * @extends {goog.events.EventTarget}
 */
ol.MapBrowserEventHandler = function(map) {

  goog.base(this);

  /**
   * This is the element that we will listen to the real events on.
   * @type {ol.Map}
   * @private
   */
  this.map_ = map;

  /**
   * @type {number}
   * @private
   */
  this.clickTimeoutId_ = 0;

  /**
   * @type {boolean}
   * @private
   */
  this.dragging_ = false;

  /**
   * @type {Array.<number>}
   * @private
   */
  this.dragListenerKeys_ = null;

  /**
   * @type {goog.events.Key}
   * @private
   */
  this.pointerdownListenerKey_ = null;

  if (ol.LEGACY_IE_SUPPORT && ol.IS_LEGACY_IE) {
    /**
     * @type {goog.events.Key}
     * @private
     */
    this.ieDblclickListenerKey_ = null;
  }

  /**
   * The most recent "down" type event (or null if none have occurred).
   * Set on pointerdown.
   * @type {ol.pointer.PointerEvent}
   * @private
   */
  this.down_ = null;

  var element = this.map_.getViewport();

  /**
   * @type {number}
   * @private
   */
  this.activePointers_ = 0;

  /**
   * @type {Object.<number, boolean>}
   * @private
   */
  this.trackedTouches_ = {};

  /**
   * Event handler which generates pointer events for
   * the viewport element.
   *
   * @type {ol.pointer.PointerEventHandler}
   * @private
   */
  this.pointerEventHandler_ = new ol.pointer.PointerEventHandler(element);

  /**
   * Event handler which generates pointer events for
   * the document (used when dragging).
   *
   * @type {ol.pointer.PointerEventHandler}
   * @private
   */
  this.documentPointerEventHandler_ = null;

  this.pointerdownListenerKey_ = goog.events.listen(this.pointerEventHandler_,
      ol.pointer.EventType.POINTERDOWN,
      this.handlePointerDown_, false, this);

  this.relayedListenerKey_ = goog.events.listen(this.pointerEventHandler_,
      ol.pointer.EventType.POINTERMOVE,
      this.relayEvent_, false, this);

  if (ol.LEGACY_IE_SUPPORT && ol.IS_LEGACY_IE) {
    /*
     * On legacy IE, double clicks do not produce two mousedown and
     * mouseup events. That is why a separate DBLCLICK event listener
     * is used.
     */
    this.ieDblclickListenerKey_ = goog.events.listen(element,
        goog.events.EventType.DBLCLICK,
        this.emulateClickLegacyIE_, false, this);
  }

};
goog.inherits(ol.MapBrowserEventHandler, goog.events.EventTarget);


/**
 * @param {goog.events.BrowserEvent} browserEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.emulateClickLegacyIE_ =
    function(browserEvent) {
  var pointerEvent = this.pointerEventHandler_.wrapMouseEvent(
      ol.MapBrowserEvent.EventType.POINTERUP,
      browserEvent
      );
  this.emulateClick_(pointerEvent);
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.emulateClick_ = function(pointerEvent) {
  var newEvent;
  newEvent = new ol.MapBrowserPointerEvent(
      ol.MapBrowserEvent.EventType.CLICK, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);
  if (this.clickTimeoutId_ !== 0) {
    // double-click
    goog.global.clearTimeout(this.clickTimeoutId_);
    this.clickTimeoutId_ = 0;
    newEvent = new ol.MapBrowserPointerEvent(
        ol.MapBrowserEvent.EventType.DBLCLICK, this.map_, pointerEvent);
    this.dispatchEvent(newEvent);
  } else {
    // click
    this.clickTimeoutId_ = goog.global.setTimeout(goog.bind(function() {
      this.clickTimeoutId_ = 0;
      var newEvent = new ol.MapBrowserPointerEvent(
          ol.MapBrowserEvent.EventType.SINGLECLICK, this.map_, pointerEvent);
      this.dispatchEvent(newEvent);
    }, this), 250);
  }
};


/**
 * Keeps track on how many pointers are currently active.
 *
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.updateActivePointers_ =
    function(pointerEvent) {
  var event = pointerEvent;

  if (event.type == ol.MapBrowserEvent.EventType.POINTERUP ||
      event.type == ol.MapBrowserEvent.EventType.POINTERCANCEL) {
    delete this.trackedTouches_[event.pointerId];
  } else if (event.type == ol.MapBrowserEvent.EventType.POINTERDOWN) {
    this.trackedTouches_[event.pointerId] = true;
  }
  this.activePointers_ = goog.object.getCount(this.trackedTouches_);
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.handlePointerUp_ = function(pointerEvent) {
  this.updateActivePointers_(pointerEvent);
  var newEvent = new ol.MapBrowserPointerEvent(
      ol.MapBrowserEvent.EventType.POINTERUP, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);

  // We emulate click events on left mouse button click, touch contact, and pen
  // contact. isMouseActionButton returns true in these cases (evt.button is set
  // to 0).
  // See http://www.w3.org/TR/pointerevents/#button-states
  if (!this.dragging_ && this.isMouseActionButton_(pointerEvent)) {
    goog.asserts.assert(!goog.isNull(this.down_));
    this.emulateClick_(this.down_);
  }

  goog.asserts.assert(this.activePointers_ >= 0);
  if (this.activePointers_ === 0) {
    goog.array.forEach(this.dragListenerKeys_, goog.events.unlistenByKey);
    this.dragListenerKeys_ = null;
    this.dragging_ = false;
    this.down_ = null;
    goog.dispose(this.documentPointerEventHandler_);
    this.documentPointerEventHandler_ = null;
  }
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @return {boolean} If the left mouse button was pressed.
 * @private
 */
ol.MapBrowserEventHandler.prototype.isMouseActionButton_ =
    function(pointerEvent) {
  if (ol.LEGACY_IE_SUPPORT && ol.IS_LEGACY_IE) {
    return pointerEvent.button == 1;
  } else {
    return pointerEvent.button === 0;
  }
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.handlePointerDown_ =
    function(pointerEvent) {
  this.updateActivePointers_(pointerEvent);
  var newEvent = new ol.MapBrowserPointerEvent(
      ol.MapBrowserEvent.EventType.POINTERDOWN, this.map_, pointerEvent);
  this.dispatchEvent(newEvent);

  this.down_ = pointerEvent;

  if (goog.isNull(this.dragListenerKeys_)) {
    /* Set up a pointer event handler on the `document`,
     * which is required when the pointer is moved outside
     * the viewport when dragging.
     */
    this.documentPointerEventHandler_ =
        new ol.pointer.PointerEventHandler(document);

    this.dragListenerKeys_ = [
      goog.events.listen(this.documentPointerEventHandler_,
          ol.MapBrowserEvent.EventType.POINTERMOVE,
          this.handlePointerMove_, false, this),
      goog.events.listen(this.documentPointerEventHandler_,
          ol.MapBrowserEvent.EventType.POINTERUP,
          this.handlePointerUp_, false, this),
      /* Note that the listener for `pointercancel is set up on
       * `pointerEventHandler_` and not `documentPointerEventHandler_` like
       * the `pointerup` and `pointermove` listeners.
       *
       * The reason for this is the following: `TouchSource.vacuumTouches_()`
       * issues `pointercancel` events, when there was no `touchend` for a
       * `touchstart`. Now, let's say a first `touchstart` is registered on
       * `pointerEventHandler_`. The `documentPointerEventHandler_` is set up.
       * But `documentPointerEventHandler_` doesn't know about the first
       * `touchstart`. If there is no `touchend` for the `touchstart`, we can
       * only receive a `touchcancel` from `pointerEventHandler_`, because it is
       * only registered there.
       */
      goog.events.listen(this.pointerEventHandler_,
          ol.MapBrowserEvent.EventType.POINTERCANCEL,
          this.handlePointerUp_, false, this)
    ];
  }
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.handlePointerMove_ =
    function(pointerEvent) {
  // Fix IE10 on windows Surface : When you tap the tablet, it triggers
  // multiple pointermove events between pointerdown and pointerup with
  // the exact same coordinates of the pointerdown event. To avoid a
  // 'false' touchmove event to be dispatched , we test if the pointer
  // effectively moved.
  if (this.isMoving_(pointerEvent)) {
    this.dragging_ = true;
    var newEvent = new ol.MapBrowserPointerEvent(
        ol.MapBrowserEvent.EventType.POINTERDRAG, this.map_, pointerEvent,
        this.dragging_);
    this.dispatchEvent(newEvent);
  }

  // Some native android browser triggers mousemove events during small period
  // of time. See: https://code.google.com/p/android/issues/detail?id=5491 or
  // https://code.google.com/p/android/issues/detail?id=19827
  // ex: Galaxy Tab P3110 + Android 4.1.1
  pointerEvent.preventDefault();
};


/**
 * Wrap and relay a pointer event.  Note that this requires that the type
 * string for the MapBrowserPointerEvent matches the PointerEvent type.
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @private
 */
ol.MapBrowserEventHandler.prototype.relayEvent_ = function(pointerEvent) {
  var dragging = !goog.isNull(this.down_) && this.isMoving_(pointerEvent);
  this.dispatchEvent(new ol.MapBrowserPointerEvent(
      pointerEvent.type, this.map_, pointerEvent, dragging));
};


/**
 * @param {ol.pointer.PointerEvent} pointerEvent Pointer event.
 * @return {boolean}
 * @private
 */
ol.MapBrowserEventHandler.prototype.isMoving_ = function(pointerEvent) {
  return pointerEvent.clientX != this.down_.clientX ||
      pointerEvent.clientY != this.down_.clientY;
};


/**
 * @inheritDoc
 */
ol.MapBrowserEventHandler.prototype.disposeInternal = function() {
  if (!goog.isNull(this.relayedListenerKey_)) {
    goog.events.unlistenByKey(this.relayedListenerKey_);
    this.relayedListenerKey_ = null;
  }
  if (!goog.isNull(this.pointerdownListenerKey_)) {
    goog.events.unlistenByKey(this.pointerdownListenerKey_);
    this.pointerdownListenerKey_ = null;
  }
  if (!goog.isNull(this.dragListenerKeys_)) {
    goog.array.forEach(this.dragListenerKeys_, goog.events.unlistenByKey);
    this.dragListenerKeys_ = null;
  }
  if (!goog.isNull(this.documentPointerEventHandler_)) {
    goog.dispose(this.documentPointerEventHandler_);
    this.documentPointerEventHandler_ = null;
  }
  if (!goog.isNull(this.pointerEventHandler_)) {
    goog.dispose(this.pointerEventHandler_);
    this.pointerEventHandler_ = null;
  }
  if (ol.LEGACY_IE_SUPPORT && ol.IS_LEGACY_IE &&
      !goog.isNull(this.ieDblclickListenerKey_)) {
    goog.events.unlistenByKey(this.ieDblclickListenerKey_);
    this.ieDblclickListenerKey_ = null;
  }
  goog.base(this, 'disposeInternal');
};

