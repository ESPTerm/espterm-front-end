const webpack = require('webpack')
const { execSync } = require('child_process')
const path = require('path')

let hash = execSync('git rev-parse --short HEAD').toString().trim()

let plugins = [new webpack.optimize.UglifyJsPlugin()]
let devtool = 'source-map'

if (process.env.ESP_PROD) {
  // ignore demo
  plugins.push(new webpack.IgnorePlugin(/\.\/demo(?:\.js)?$/))

  // no source maps
  devtool = ''
}

module.exports = {
  entry: './js',
  output: {
    path: path.resolve(__dirname, 'out', 'js'),
    filename: `app.${hash}.js`
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: [
          path.resolve(__dirname, 'node_modules')
        ],
        loader: 'babel-loader'
      }
    ]
  },
  devtool,
  plugins
}