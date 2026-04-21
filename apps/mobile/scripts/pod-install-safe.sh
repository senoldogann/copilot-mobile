#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
IOS_DIR="${APP_DIR}/ios"

export PATH="/Applications/Codex.app/Contents/Resources:${PATH}"
export GEM_HOME="${HOME}/.gem/ruby/2.6.0"
export GEM_PATH="${HOME}/.gem/ruby/2.6.0"
export NODE_BINARY="/Applications/Codex.app/Contents/Resources/node"

cd "${IOS_DIR}"

ruby -rlogger -rnkf <<'RUBY'
require 'rubygems'
gem 'xcodeproj', '1.27.0'
require 'xcodeproj/plist'
require 'json'
require 'shellwords'

module Xcodeproj
  module Plist
    def self.read_from_path(path)
      path = path.to_s
      raise Informative, "The plist file at path `#{path}` doesn't exist." unless File.exist?(path)

      contents = File.read(path)
      raise Informative, "The file `#{path}` is in a merge conflict." if file_in_conflict?(contents)

      case Nanaimo::Reader.plist_type(contents)
      when :xml, :binary
        JSON.parse(`/usr/bin/plutil -convert json -o - #{Shellwords.escape(path)}`)
      else
        Nanaimo::Reader.new(contents).parse!.as_ruby
      end
    end
  end
end

gem 'cocoapods', '1.16.2'
require 'cocoapods'
Pod::Command.run(['install', '--verbose', '--no-repo-update'])
RUBY
