# frozen_string_literal: true
# The site renders the plugin with LiquidJS in the browser; this spec renders the same cases with trmnlp's Ruby Liquid
# (no browser started) so check_fidelity.mjs can compare. Run through tools/site/check_fidelity.sh.
require 'json'
# A real device: the transform input has no sensor_readings (TRMNL adds it to the markup's variables at render time); the
# same patch as tools/render_check_spec.rb.
module SensorsAfterTransform
  def call(device: {})
    r = super
    sr = config.project.user_data_overrides['sensor_readings']
    r['sensor_readings'] = sr if sr
    r
  end

  private

  def transform_input(merged)
    super(merged.reject { |k, _| k == 'sensor_readings' })
  end
end
TRMNLP::UserDataAssembler.prepend(SensorsAfterTransform)
RSpec.describe 'site fidelity' do
  cases = JSON.parse(File.read(ENV.fetch('SW_FID_IN')))
  cases.each do |c|
    it c['name'] do
      dev = TRMNLP::Testing::DeviceModels.find(c['model'])
      vars = { 'trmnl' => { 'user' => { 'locale' => c['locale'] }, 'device' => { 'id' => 1 } } }
      vars['sensor_readings'] = c['sensor_readings'] if c['sensor_readings']
      mocks = { 'https://api.open-meteo.com/*' => { json: c['answer'] }, 'https://air-quality-api.open-meteo.com/*' => { json: c['aq'] } }
      run = trmnl.send(:run, Time.iso8601(c['now']), mocks:, custom_fields: c['fields'], variables: vars)
      r = run.render(view: c['view'], device: dev.render_params, screen_classes: dev.screen_classes, theme: nil, scale: nil, text_scale: nil)
      raise "transform error #{r.error.inspect}" if r.error
      File.write(File.join(ENV.fetch('SW_FID_OUT'), "#{c['name']}.json"), JSON.generate(data: r.data, html: r.html))
    end
  end
end
