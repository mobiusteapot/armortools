
type storage_t = {
	project?: string;
	file?: string;
	text?: string;
	modified?: bool;
	expanded?: string[];
	window_w?: i32;
	window_h?: i32;
	window_x?: i32;
	window_y?: i32;
	sidebar_w?: i32;
};

let ui: zui_t;
let theme: zui_theme_t;
let text_handle: zui_handle_t = zui_handle_create();
let sidebar_handle: zui_handle_t = zui_handle_create();
let editor_handle: zui_handle_t = zui_handle_create();
let storage: storage_t = null;
let resizing_sidebar: bool = false;
let minimap_w: i32 = 150;
let minimap_h: i32 = 0;
let minimap_box_h: i32 = 0;
let minimap_scrolling: bool = false;
let minimap: image_t = null;
let window_header_h: i32 = 0;

function drop_files(path: string) {
	storage.project = path;
	sidebar_handle.redraws = 1;
}

function shutdown() {
	let storage_string: string = sys_string_to_buffer(json_stringify(storage));
	krom_file_save_bytes(krom_save_path() + "/config.json", storage_string, 0);
}

function main() {
	krom_set_app_name("ArmorPad");

	let blob_storage: buffer_t = krom_load_blob(krom_save_path() + "/config.json");
	if (blob_storage == null) {
		storage = {};
		storage.project = "";
		storage.file = "untitled";
		storage.text = "";
		storage.modified = false;
		storage.expanded = [];
		storage.window_w = 1600;
		storage.window_h = 900;
		storage.window_x = -1;
		storage.window_y = -1;
		storage.sidebar_w = 230;
	}
	else {
		storage = json_parse(sys_buffer_to_string(blob_storage));
	}

	text_handle.text = storage.text;

	let ops: kinc_sys_ops_t = {
		title: "ArmorPad",
		x: storage.window_x,
		y: storage.window_y,
		width: storage.window_w,
		height: storage.window_h,
		features: window_features_t.RESIZABLE |
				  window_features_t.MAXIMIZABLE |
				  window_features_t.MINIMIZABLE,
		mode: window_mode_t.WINDOWED,
		frequency: 60,
		vsync: true,
	};
	sys_start(ops);

	let font: g2_font_t = data_get_font("font_mono.ttf");
	g2_font_init(font);

	theme = {};
	zui_theme_default(theme);

	let zui_ops: zui_options_t = { scale_factor: 1.0, theme: theme, font: font };
	ui = zui_create(zui_ops);

	let blob_coloring: buffer_t = data_get_blob("text_coloring.json");
	let text_coloring: zui_text_coloring_t = json_parse(sys_buffer_to_string(blob_coloring));
	zui_text_area_coloring = text_coloring;
	zui_on_border_hover = on_border_hover;
	zui_on_text_hover = on_text_hover;
	zui_text_area_line_numbers = true;
	zui_text_area_scroll_past_end = true;

	sys_notify_on_frames(render);
	krom_set_drop_files_callback(drop_files);
	krom_set_application_state_callback(null, null, null, null, shutdown);
}

function list_folder(path: string) {
	let files: string[] = string_split(krom_read_directory(path, false), "\n");
	for (let i: i32 = 0; i < files.length; ++i) {
		let f: string = files[i];
		let abs: string = path + "/" + f;
		let is_file: bool = string_index_of(f, ".") >= 0;
		let is_expanded: bool = array_index_of(storage.expanded, abs) >= 0;

		// Active file
		if (abs == storage.file) {
			zui_fill(0, 1, ui._w - 1, ZUI_ELEMENT_H() - 1, theme.BUTTON_PRESSED_COL);
		}

		let prefix: string = "";
		if (!is_file) {
			prefix = is_expanded ? "- " : "+ ";
		}

		if (zui_button(prefix + f, ZUI_ALIGN_LEFT, "")) {
			// Open file
			if (is_file) {
				storage.file = abs;
				let bytes: buffer_t = krom_load_blob(storage.file);
				storage.text = ends_with(f, ".arm") ? json_stringify(armpack_decode(bytes)) : sys_buffer_to_string(bytes);
				storage.text = string_replace_all(storage.text, "\r", "");
				text_handle.text = storage.text;
				editor_handle.redraws = 1;
				krom_set_window_title(abs);
			}
			// Expand folder
			else {
				array_index_of(storage.expanded, abs) == -1 ? array_push(storage.expanded, abs) : array_remove(storage.expanded, abs);
			}
		}

		if (is_expanded) {
			list_folder(abs);
		}
	}
}

function render() {
	storage.window_w = sys_width();
	storage.window_h = sys_height();
	storage.window_x = krom_window_x();
	storage.window_y = krom_window_y();
	if (ui.input_dx != 0 || ui.input_dy != 0) {
		krom_set_mouse_cursor(0); // Arrow
	}

	zui_begin(ui);

	if (zui_window(sidebar_handle, 0, 0, storage.sidebar_w, sys_height(), false)) {
		let _BUTTON_TEXT_COL: i32 = theme.BUTTON_TEXT_COL;
		theme.BUTTON_TEXT_COL = theme.ACCENT_COL;
		if (storage.project != "") {
			list_folder(storage.project);
		}
		else {
			zui_button("Drop folder here", ZUI_ALIGN_LEFT, "");
		}
		theme.BUTTON_TEXT_COL = _BUTTON_TEXT_COL;
	}

	zui_fill(sys_width() - minimap_w, 0, minimap_w, ZUI_ELEMENT_H() + ZUI_ELEMENT_OFFSET() + 1, theme.SEPARATOR_COL);
	zui_fill(storage.sidebar_w, 0, 1, sys_height(), theme.SEPARATOR_COL);

	let editor_updated: bool = false;

	if (zui_window(editor_handle, storage.sidebar_w + 1, 0, sys_width() - storage.sidebar_w - minimap_w, sys_height(), false)) {
		editor_updated = true;
		let htab: zui_handle_t = zui_handle(__ID__);
		let file_name: string = substring(storage.file, string_last_index_of(storage.file, "/") + 1, storage.file.length);
		let file_names: string[] = [file_name];

		for (let i: i32 = 0; i < file_names.length; ++i) {
			let tab_name: string = file_names[i];
			if (storage.modified) {
				tab_name += "*";
			}
			if (zui_tab(htab, tab_name, false, -1)) {
				// File modified
				if (ui.is_key_pressed) {
					storage.modified = true;
				}

				// Save
				if (ui.is_ctrl_down && ui.key_code == key_code_t.S) {
					save_file();
				}

				// storage.text = zui_text_area(text_handle, ZUI_ALIGN_LEFT, true, "", false);
				zui_text_area(text_handle, ZUI_ALIGN_LEFT, true, "", false);
			}
		}

		window_header_h = 32;//math_floor(ui.windowHeaderH);
	}

	if (resizing_sidebar) {
		storage.sidebar_w += math_floor(ui.input_dx);
	}
	if (!ui.input_down) {
		resizing_sidebar = false;
	}

	// Minimap controls
	let minimap_x: i32 = sys_width() - minimap_w;
	let minimap_y: i32 = window_header_h + 1;
	let redraw: bool = false;
	if (ui.input_started && hit_test(ui.input_x, ui.input_y, minimap_x + 5, minimap_y, minimap_w, minimap_h)) {
		minimap_scrolling = true;
	}
	if (!ui.input_down) {
		minimap_scrolling = false;
	}
	if (minimap_scrolling) {
		redraw = true;
	}

	// Build project
	if (ui.is_ctrl_down && ui.key_code == key_code_t.B) {
		save_file();
		build_project();
	}

	zui_end(false);

	if (redraw) {
		editor_handle.redraws = 2;
	}

	if (minimap != null) {
		g2_begin();
		g2_draw_image(minimap, minimap_x, minimap_y);
		g2_end();
	}

	if (editor_updated) {
		draw_minimap();
	}
}

function save_file() {
	// Trim
	let lines: string[] = string_split(storage.text, "\n");
	for (let i: i32 = 0; i < lines.length; ++i) {
		lines[i] = trim_end(lines[i]);
	}
	storage.text = string_array_join(lines, "\n");
	// Spaces to tabs
	storage.text = string_replace_all(storage.text, "    ", "\t");
	text_handle.text = storage.text;
	// Write bytes
	// let bytes: buffer_t = ends_with(storage.file, ".arm") ? armpack_encode(json_parse(storage.text)) : sys_string_to_buffer(storage.text);
	// krom_file_save_bytes(storage.file, bytes, buffer_size(bytes));
	storage.modified = false;
}

function build_file(): string {
	///if krom_windows
	return "\\build.bat";
	///else
	return "/build.sh";
	///end
}

function build_project() {
	krom_sys_command(storage.project + build_file() + " " + storage.project, null);
}

function draw_minimap() {
	if (minimap_h != sys_height()) {
		minimap_h = sys_height();
		if (minimap != null) {
			image_unload(minimap);
		}
		minimap = image_create_render_target(minimap_w, minimap_h);
	}

	g2_begin(minimap);
	g2_clear(theme.SEPARATOR_COL);
	g2_set_color(0xff333333);
	let lines: string[] = string_split(storage.text, "\n");
	let minimap_full_h: i32 = lines.length * 2;
	let scroll_progress: f32 = -editor_handle.scroll_offset / (lines.length * ZUI_ELEMENT_H());
	let out_of_screen: i32 = minimap_full_h - minimap_h;
	if (out_of_screen < 0) {
		out_of_screen = 0;
	}
	let offset: i32 = math_floor((out_of_screen * scroll_progress) / 2);

	for (let i: i32 = 0; i < lines.length; ++i) {
		if (i * 2 > minimap_h || i + offset >= lines.length) {
			// Out of screen
			break;
		}
		let words: string[] = string_split(lines[i + offset], " ");
		let x: i32 = 0;
		for (let j: i32 = 0; j < words.length; ++j) {
			let word: string = words[j];
			g2_fill_rect(x, i * 2, word.length, 2);
			x += word.length + 1;
		}
	}

	// Current position
	let visible_area: i32 = out_of_screen > 0 ? minimap_h : minimap_full_h;
	g2_set_color(0x11ffffff);
	minimap_box_h = math_floor((sys_height() - window_header_h) / ZUI_ELEMENT_H() * 2);
	g2_fill_rect(0, scroll_progress * visible_area, minimap_w, minimap_box_h);
	g2_end();
}

function hit_test(mx: f32, my: f32, x: f32, y: f32, w: f32, h: f32): bool {
	return mx > x && mx < x + w && my > y && my < y + h;
}

function on_border_hover(handle: zui_handle_t, side: i32) {
	if (handle != sidebar_handle) {
		return;
	}
	if (side != 1) {
		return; // Right
	}

	krom_set_mouse_cursor(3); // Horizontal

	if (zui_get_current().input_started) {
		resizing_sidebar = true;
	}
}

function on_text_hover() {
	krom_set_mouse_cursor(2); // I-cursor
}
