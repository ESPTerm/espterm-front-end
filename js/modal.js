const $ = require('./lib/chibi')

/** Module for toggling a modal overlay */
let modal = {}
let curCloseCb = null

modal.show = function (sel, closeCb) {
  let $m = $(sel)
  $m.removeClass('hidden visible')
  setTimeout(function () {
    $m.addClass('visible')
  }, 1)
  curCloseCb = closeCb
}

modal.hide = function (sel) {
  let $m = $(sel)
  $m.removeClass('visible')
  setTimeout(function () {
    $m.addClass('hidden')
    if (curCloseCb) curCloseCb()
  }, 500) // transition time
}

modal.init = function () {
  // close modal by click outside the dialog
  $('.Modal').on('click', function () {
    if ($(this).hasClass('no-close')) return // this is a no-close modal
    modal.hide(this)
  })

  $('.Dialog').on('click', function (e) {
    e.stopImmediatePropagation()
  })

  // Hide all modals on esc
  $(window).on('keydown', function (e) {
    if (e.which === 27) {
      modal.hide('.Modal')
    }
  })
}

module.exports = modal
