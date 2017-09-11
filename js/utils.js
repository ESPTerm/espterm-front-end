/** Make a node */
function mk (e) {
  return document.createElement(e)
}

/** Find one by query */
function qs (s) {
  return document.querySelector(s)
}

/** Find all by query */
function qsa (s) {
  return document.querySelectorAll(s)
}

/** Convert any to bool safely */
function bool (x) {
  return (x === 1 || x === '1' || x === true || x === 'true')
}

/**
 * Filter 'spacebar' and 'return' from keypress handler,
 * and when they're pressed, fire the callback.
 * use $(...).on('keypress', cr(handler))
 */
function cr (hdl) {
  return function (e) {
    if (e.which === 10 || e.which === 13 || e.which === 32) {
      hdl()
    }
  }
}

/** HTML escape */
function esc (str) {
  return $.htmlEscape(str)
}

/** Check for undefined */
function undef (x) {
  return typeof x == 'undefined'
}

/** Safe json parse */
function jsp (str) {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.error(e)
    return null
  }
}

/** Create a character from ASCII code */
function Chr (n) {
  return String.fromCharCode(n)
}

/** Decode number from 2B encoding */
function parse2B (s, i = 0) {
  return (s.charCodeAt(i++) - 1) + (s.charCodeAt(i) - 1) * 127
}

/** Decode number from 3B encoding */
function parse3B (s, i = 0) {
  return (s.charCodeAt(i) - 1) + (s.charCodeAt(i + 1) - 1) * 127 + (s.charCodeAt(i + 2) - 1) * 127 * 127
}

/** Encode using 2B encoding, returns string. */
function encode2B (n) {
  let lsb, msb
  lsb = (n % 127)
  n = ((n - lsb) / 127)
  lsb += 1
  msb = (n + 1)
  return Chr(lsb) + Chr(msb)
}

/** Encode using 3B encoding, returns string. */
function encode3B (n) {
  let lsb, msb, xsb
  lsb = (n % 127)
  n = (n - lsb) / 127
  lsb += 1
  msb = (n % 127)
  n = (n - msb) / 127
  msb += 1
  xsb = (n + 1)
  return Chr(lsb) + Chr(msb) + Chr(xsb)
}