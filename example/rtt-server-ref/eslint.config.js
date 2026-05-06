const js = require("@eslint/js")
const globals = require("globals")

var globals_client_js = {
	params: false,
	roles: false,
	player: false,
	view: false,
	static_view: false,
	scroll_into_view: false,
	scroll_into_view_if_needed: false,
	drag_element_with_mouse: false,
	action_button: false,
	action_button_with_argument: false,
	confirm_action_button: false,
	send_action: false,
	confirm_send_action: false,
	send_query: false,
}

module.exports = [
	js.configs.recommended,
	{
		files: [ "**/*.js" ],
		languageOptions: {
			globals: {
				...globals.commonjs,
			},
		},
		rules: {
			"no-constant-binary-expression": "error",
			indent: [ "warn", "tab", { SwitchCase: 0 } ],
			semi: [ "error", "never" ],
			"no-unused-vars": [ "error", { vars: "all", args: "all", argsIgnorePattern: "^_" } ],
		},
	},
	{
		files: [ "**/client.js" ],
		languageOptions: {
			globals: {
				... globals.browser,
			},
		},
	},
	{
		files: [ "**/play.js" ],
		languageOptions: {
			globals: {
				... globals.browser,
				... globals_client_js,
			},
		},
	},
	{
		files: [ "server.js" ],
		languageOptions: {
			globals: {
				... globals.node,
			},
		},
	},
]
