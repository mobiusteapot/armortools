
///if (is_paint || is_sculpt)

function tab_materials_draw(htab: zui_handle_t) {
	let mini: bool = config_raw.layout[layout_size_t.SIDEBAR_W] <= ui_base_sidebar_mini_w;
	mini ? tab_materials_draw_mini(htab) : tab_materials_draw_full(htab);
}

function tab_materials_draw_mini(htab: zui_handle_t) {
	zui_set_hovered_tab_name(tr("Materials"));

	zui_begin_sticky();
	zui_separator(5);

	tab_materials_button_nodes();
	tab_materials_button_new("+");

	zui_end_sticky();
	zui_separator(3, false);
	tab_materials_draw_slots(true);
}

function tab_materials_draw_full(htab: zui_handle_t) {
	if (zui_tab(htab, tr("Materials"))) {
		zui_begin_sticky();
		let row: f32[] = [1 / 4, 1 / 4, 1 / 4];
		zui_row(row);

		tab_materials_button_new(tr("New"));
		if (zui_button(tr("Import"))) {
			project_import_material();
		}
		tab_materials_button_nodes();

		zui_end_sticky();
		zui_separator(3, false);
		tab_materials_draw_slots(false);
	}
}

function tab_materials_button_nodes() {
	let ui: zui_t = ui_base_ui;
	if (zui_button(tr("Nodes"))) {
		ui_base_show_material_nodes();
	}
	else if (ui.is_hovered) {
		zui_tooltip(tr("Show Node Editor") + " (" + map_get(config_keymap, "toggle_node_editor") + ")");
	}
}

let _tab_materials_draw_slots: i32;

function tab_materials_draw_slots(mini: bool) {
	let ui: zui_t = ui_base_ui;
	let slotw: i32 = math_floor(51 * zui_SCALE(ui));
	let num: i32 = math_floor(config_raw.layout[layout_size_t.SIDEBAR_W] / slotw);

	for (let row: i32 = 0; row < math_floor(math_ceil(project_materials.length / num)); ++row) {
		let mult: i32 = config_raw.show_asset_names ? 2 : 1;
		let ar: f32[] = [];
		for (let i: i32 = 0; i < num * mult; ++i) {
			array_push(ar, 1 / num);
		}
		zui_row(ar);

		ui._x += 2;
		let off: f32 = config_raw.show_asset_names ? zui_ELEMENT_OFFSET(ui) * 10.0 : 6;
		if (row > 0) {
			ui._y += off;
		}

		for (let j: i32 = 0; j < num; ++j) {
			let imgw: i32 = math_floor(50 * zui_SCALE(ui));
			let i: i32 = j + row * num;
			if (i >= project_materials.length) {
				_zui_end_element(imgw);
				if (config_raw.show_asset_names) {
					_zui_end_element(0);
				}
				continue;
			}
			let img: image_t = zui_SCALE(ui) > 1 ? project_materials[i].image : project_materials[i].image_icon;
			let imgFull: image_t = project_materials[i].image;

			// Highligh selected
			if (context_raw.material == project_materials[i]) {
				if (mini) {
					let w: f32 = ui._w / zui_SCALE(ui);
					zui_rect(0, -2, w - 2, w - 4, ui.ops.theme.HIGHLIGHT_COL, 3);
				}
				else {
					let off: i32 = row % 2 == 1 ? 1 : 0;
					let w: i32 = 50;
					if (config_raw.window_scale > 1) {
						w += math_floor(config_raw.window_scale * 2);
					}
					zui_fill(-1,         -2, w + 3,       2, ui.ops.theme.HIGHLIGHT_COL);
					zui_fill(-1,    w - off, w + 3, 2 + off, ui.ops.theme.HIGHLIGHT_COL);
					zui_fill(-1,         -2,     2,   w + 3, ui.ops.theme.HIGHLIGHT_COL);
					zui_fill(w + 1,      -2,     2,   w + 4, ui.ops.theme.HIGHLIGHT_COL);
				}
			}

			///if krom_opengl
			ui.image_invert_y = project_materials[i].preview_ready;
			///end

			// Draw material icon
			let uix: f32 = ui._x;
			let uiy: f32 = ui._y;
			let tile: i32 = zui_SCALE(ui) > 1 ? 100 : 50;
			let imgh: f32 = mini ? ui_base_default_sidebar_mini_w * 0.85 * zui_SCALE(ui) : -1.0;
			let state: zui_state_t = project_materials[i].preview_ready ?
				_zui_image(img, 0xffffffff, imgh) :
				_zui_image(resource_get("icons.k"), 0xffffffff, -1.0, tile, tile, tile, tile);

			// Draw material numbers when selecting a material via keyboard shortcut
			let is_typing: bool = ui.is_typing || ui_view2d_ui.is_typing || ui_nodes_ui.is_typing;
			if (!is_typing) {
				if (i < 9 && operator_shortcut(map_get(config_keymap, "select_material"), shortcut_type_t.DOWN)) {
					let number: string = i32_to_string(i + 1);
					let width: i32 = g2_font_width(ui.ops.font, ui.font_size, number) + 10;
					let height: i32 = g2_font_height(ui.ops.font, ui.font_size);
					g2_set_color(ui.ops.theme.TEXT_COL);
					g2_fill_rect(uix, uiy, width, height);
					g2_set_color(ui.ops.theme.ACCENT_COL);
					g2_draw_string(number, uix + 5, uiy);
				}
			}

			// Select material
			if (state == zui_state_t.STARTED && ui.input_y > ui._window_y) {
				if (context_raw.material != project_materials[i]) {
					context_select_material(i);
					///if is_paint
					if (context_raw.tool == workspace_tool_t.MATERIAL) {
						app_notify_on_init(base_update_fill_layers);
					}
					///end
				}
				base_drag_off_x = -(mouse_x - uix - ui._window_x - 3);
				base_drag_off_y = -(mouse_y - uiy - ui._window_y + 1);
				base_drag_material = context_raw.material;
				// Double click to show nodes
				if (time_time() - context_raw.select_time < 0.25) {
					ui_base_show_material_nodes();
					base_drag_material = null;
					base_is_dragging = false;
				}
				context_raw.select_time = time_time();
			}

			// Context menu
			if (ui.is_hovered && ui.input_released_r) {
				context_select_material(i);
				let add: i32 = project_materials.length > 1 ? 1 : 0;
				_tab_materials_draw_slots = i;

				ui_menu_draw(function (ui: zui_t) {
					let i: i32 = _tab_materials_draw_slots;
					let m: slot_material_t = project_materials[i];

					if (ui_menu_button(ui, tr("To Fill Layer"))) {
						context_select_material(i);
						base_create_fill_layer();
					}

					if (ui_menu_button(ui, tr("Export"))) {
						context_select_material(i);
						box_export_show_material();
					}

					///if is_paint
					if (ui_menu_button(ui, tr("Bake"))) {
						context_select_material(i);
						box_export_show_bake_material();
					}
					///end

					if (ui_menu_button(ui, tr("Duplicate"))) {
						app_notify_on_init(function () {
							let i: i32 = _tab_materials_draw_slots;

							context_raw.material = slot_material_create(project_materials[0].data);
							array_push(project_materials, context_raw.material);
							let cloned: zui_node_canvas_t = json_parse(json_stringify(project_materials[i].canvas));
							context_raw.material.canvas = cloned;
							tab_materials_update_material();
							history_duplicate_material();
						});
					}

					if (project_materials.length > 1 && ui_menu_button(ui, tr("Delete"), "delete")) {
						tab_materials_delete_material(m);
					}

					let base_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (base_handle.init) {
						base_handle.selected = m.paint_base;
					}

					let opac_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (opac_handle.init) {
						opac_handle.selected = m.paint_opac;
					}

					let nor_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (nor_handle.init) {
						nor_handle.selected = m.paint_nor;
					}

					let occ_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (occ_handle.init) {
						occ_handle.selected = m.paint_occ;
					}

					let rough_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (rough_handle.init) {
						rough_handle.selected = m.paint_rough;
					}

					let met_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (met_handle.init) {
						met_handle.selected = m.paint_met;
					}

					let height_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (height_handle.init) {
						height_handle.selected = m.paint_height;
					}

					let emis_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (emis_handle.init) {
						emis_handle.selected = m.paint_emis;
					}

					let subs_handle: zui_handle_t = zui_nest(zui_handle(__ID__), m.id);
					if (subs_handle.init) {
						subs_handle.selected = m.paint_subs;
					}

					ui_menu_fill(ui);
					m.paint_base = zui_check(base_handle, tr("Base Color"));
					ui_menu_fill(ui);
					m.paint_opac = zui_check(opac_handle, tr("Opacity"));
					ui_menu_fill(ui);
					m.paint_nor = zui_check(nor_handle, tr("Normal"));
					ui_menu_fill(ui);
					m.paint_occ = zui_check(occ_handle, tr("Occlusion"));
					ui_menu_fill(ui);
					m.paint_rough = zui_check(rough_handle, tr("Roughness"));
					ui_menu_fill(ui);
					m.paint_met = zui_check(met_handle, tr("Metallic"));
					ui_menu_fill(ui);
					m.paint_height = zui_check(height_handle, tr("Height"));
					ui_menu_fill(ui);
					m.paint_emis = zui_check(emis_handle, tr("Emission"));
					ui_menu_fill(ui);
					m.paint_subs = zui_check(subs_handle, tr("Subsurface"));
					if (base_handle.changed ||
						opac_handle.changed ||
						nor_handle.changed ||
						occ_handle.changed ||
						rough_handle.changed ||
						met_handle.changed ||
						height_handle.changed ||
						emis_handle.changed ||
						subs_handle.changed) {
						make_material_parse_paint_material();
						ui_menu_keep_open = true;
					}
				}, 13 + add);
			}
			if (ui.is_hovered) {
				_zui_tooltip_image(imgFull);
				if (i < 9) {
					let i1: i32 = i + 1;
					zui_tooltip(project_materials[i].canvas.name + " - (" + map_get(config_keymap, "select_material") + " " + i1 + ")");
				}
				else {
					zui_tooltip(project_materials[i].canvas.name);
				}
			}

			if (config_raw.show_asset_names) {
				ui._x = uix;
				ui._y += slotw * 0.9;
				zui_text(project_materials[i].canvas.name, zui_align_t.CENTER);
				if (ui.is_hovered) {
					if (i < 9) {
						let i1: i32 = i + 1;
						zui_tooltip(project_materials[i].canvas.name + " - (" + map_get(config_keymap, "select_material") + " " + i1 + ")");
					}
					else {
						zui_tooltip(project_materials[i].canvas.name);
					}
				}
				ui._y -= slotw * 0.9;
				if (i == project_materials.length - 1) {
					ui._y += j == num - 1 ? imgw : imgw + zui_ELEMENT_H(ui) + zui_ELEMENT_OFFSET(ui);
				}
			}
		}

		ui._y += mini ? 0 : 6;

		///if krom_opengl
		ui.image_invert_y = false; // Material preview
		///end
	}

	let in_focus: bool = ui.input_x > ui._window_x && ui.input_x < ui._window_x + ui._window_w &&
						 ui.input_y > ui._window_y && ui.input_y < ui._window_y + ui._window_h;
	if (in_focus && ui.is_delete_down && project_materials.length > 1) {
		ui.is_delete_down = false;
		tab_materials_delete_material(context_raw.material);
	}
}

function tab_materials_button_new(text: string) {
	if (zui_button(text)) {
		let current: image_t = _g2_current;
		g2_end();
		context_raw.material = slot_material_create(project_materials[0].data);
		array_push(project_materials, context_raw.material);
		tab_materials_update_material();
		g2_begin(current);
		history_new_material();
	}
}

function tab_materials_update_material() {
	ui_header_handle.redraws = 2;
	ui_nodes_hwnd.redraws = 2;
	ui_nodes_group_stack = [];
	make_material_parse_paint_material();
	util_render_make_material_preview();
	let decal: bool = context_raw.tool == workspace_tool_t.DECAL || context_raw.tool == workspace_tool_t.TEXT;
	if (decal) {
		util_render_make_decal_preview();
	}
}

function tab_materials_update_material_pointers(nodes: zui_node_t[], i: i32) {
	for (let i: i32 = 0; i < nodes.length; ++i) {
		let n: zui_node_t = nodes[i];
		if (n.type == "MATERIAL") {
			if (n.buttons[0].default_value[0] == i) {
				n.buttons[0].default_value[0] = 9999; // Material deleted
			}
			else if (n.buttons[0].default_value[0] > i) {
				n.buttons[0].default_value[0]--; // Offset by deleted material
			}
		}
	}
}

function tab_materials_accept_swatch_drag(swatch: swatch_color_t) {
	context_raw.material = slot_material_create(project_materials[0].data);
	for (let i: i32 = 0; i < context_raw.material.canvas.nodes.length; ++i) {
		let node: zui_node_t = context_raw.material.canvas.nodes[i];
		if (node.type == "RGB" ) {
			node.outputs[0].default_value = f32_array_create_xyzw(
				color_get_rb(swatch.base) / 255,
				color_get_gb(swatch.base) / 255,
				color_get_bb(swatch.base) / 255,
				color_get_ab(swatch.base) / 255
			);
		}
		else if (node.type == "OUTPUT_MATERIAL_PBR") {
			node.inputs[1].default_value[0] = swatch.opacity;
			node.inputs[2].default_value[0] = swatch.occlusion;
			node.inputs[3].default_value[0] = swatch.roughness;
			node.inputs[4].default_value[0] = swatch.metallic;
			node.inputs[7].default_value[0] = swatch.height;
		}
	}
	array_push(project_materials, context_raw.material);
	tab_materials_update_material();
	history_new_material();
}

function tab_materials_delete_material(m: slot_material_t) {
	let i: i32 = array_index_of(project_materials, m);
	for (let i: i32 = 0; i < project_layers.length; ++i) {
		let l: slot_layer_t = project_layers[i];
		if (l.fill_layer == m) {
			l.fill_layer = null;
		}
	}
	history_delete_material();
	context_select_material(i == project_materials.length - 1 ? i - 1 : i + 1);
	array_splice(project_materials, i, 1);
	ui_base_hwnds[1].redraws = 2;
	for (let i: i32 = 0; i < project_materials.length; ++i) {
		let m: slot_material_t = project_materials[i];
		tab_materials_update_material_pointers(m.canvas.nodes, i);
	}
}

///end
