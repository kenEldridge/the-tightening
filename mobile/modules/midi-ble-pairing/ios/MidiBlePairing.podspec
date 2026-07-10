Pod::Spec.new do |s|
  s.name           = 'MidiBlePairing'
  s.version        = '0.1.0'
  s.summary        = 'Presents the system Bluetooth MIDI pairing sheet'
  s.description    = 'Wraps CABTMIDICentralViewController so the app can pair Bluetooth LE MIDI devices in-app.'
  s.author         = 'Ken Eldridge'
  s.homepage       = 'https://github.com/kenEldridge/the-tightening'
  s.license        = { type: 'MIT' }
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/kenEldridge/the-tightening' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
