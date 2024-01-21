
class ImportBlendMaterial {

	static run = (path: string) => {
		Data.getBlob(path, (b: ArrayBuffer) => {
			let bl = new ParserBlend(b);
			if (bl.dna == null) {
				Console.error(Strings.error3());
				return;
			}

			let mats = bl.get("Material");
			if (mats.length == 0) {
				Console.error("Error: No materials found");
				return;
			}

			let imported: SlotMaterial[] = [];

			for (let mat of mats) {
				// Material slot
				Context.raw.material = new SlotMaterial(Project.materials[0].data);
				Project.materials.push(Context.raw.material);
				imported.push(Context.raw.material);
				let nodes = Context.raw.material.nodes;
				let canvas = Context.raw.material.canvas;
				canvas.name = mat.get("id").get("name").substr(2); // MAWood
				let nout: TNode = null;
				for (let n of canvas.nodes) {
					if (n.type == "OUTPUT_MATERIAL_PBR") {
						nout = n;
						break;
					}
				}
				for (let n of canvas.nodes) {
					if (n.name == "RGB") {
						nodes.removeNode(n, canvas);
						break;
					}
				}

				// Parse nodetree
				let nodetree = mat.get("nodetree"); // bNodeTree
				let blnodes = nodetree.get("nodes"); // ListBase
				let bllinks = nodetree.get("links"); // bNodeLink

				// Look for Principled BSDF node
				let node: any = blnodes.get("first", 0, "bNode");
				let last = blnodes.get("last", 0, "bNode");
				while (true) {
					if (node.get("idname") == "ShaderNodeBsdfPrincipled") break;
					if (node.get("name") == last.get("name")) break;
					node = node.get("next");
				}
				if (node.get("idname") != "ShaderNodeBsdfPrincipled") {
					Console.error("Error: No Principled BSDF node found");
					continue;
				}

				// Use Principled BSDF as material output
				nout.name = node.get("name");
				nout.x = node.get("locx") + 400;
				nout.y = -node.get("locy") + 400;

				// Place nodes
				node = blnodes.get("first", 0, "bNode");
				while (true) {
					// Search for node in list
					let search = node.get("idname").substr(10).toLowerCase();
					let base: TNode = null;
					for (let list of NodesMaterial.list) {
						let found = false;
						for (let n of list) {
							let s = n.type.replace("_", "").toLowerCase();
							if (search == s) {
								base = n;
								found = true;
								break;
							}
						}
						if (found) break;
					}

					if (base != null) {
						let n = UINodes.makeNode(base, nodes, canvas);
						n.x = node.get("locx") + 400;
						n.y = -node.get("locy") + 400;
						n.name = node.get("name");

						// Fill input socket values
						let inputs = node.get("inputs");
						let sock: any = inputs.get("first", 0, "bNodeSocket");
						let pos = 0;
						while (true) {
							if (pos >= n.inputs.length) break;
							n.inputs[pos].default_value = ImportBlendMaterial.readBlendSocket(sock);

							let last = sock;
							sock = sock.get("next");
							if (last.block == sock.block) break;
							pos++;
						}

						// Fill button values
						if (search == "teximage") {
							let img = node.get("id", 0, "Image");
							let file: string = img.get("name").substr(2); // '//desktop\logo.png'
							file = Path.baseDir(path) + file;
							ImportTexture.run(file);
							let ar = file.split(Path.sep);
							let filename = ar[ar.length - 1];
							n.buttons[0].default_value = Base.getAssetIndex(filename);
						}
						else if (search == "valtorgb") {
							let ramp: any = node.get("storage", 0, "ColorBand");
							n.buttons[0].data = ramp.get("ipotype") == 0 ? 0 : 1; // Linear / Constant
							let elems: f32[][] = n.buttons[0].default_value;
							for (let i = 0; i < ramp.get("tot"); ++i) {
								if (i >= elems.length) elems.push([1.0, 1.0, 1.0, 1.0, 0.0]);
								let cbdata: any = ramp.get("data", i, "CBData");
								elems[i][0] = Math.floor(cbdata.get("r") * 100) / 100;
								elems[i][1] = Math.floor(cbdata.get("g") * 100) / 100;
								elems[i][2] = Math.floor(cbdata.get("b") * 100) / 100;
								elems[i][3] = Math.floor(cbdata.get("a") * 100) / 100;
								elems[i][4] = Math.floor(cbdata.get("pos") * 100) / 100;
							}
						}
						else if (search == "mixrgb" || search == "math") {
							n.buttons[0].default_value = node.get("custom1");
							n.buttons[1].default_value = node.get("custom2") & 2;
						}
						else if (search == "mapping") {
							let storage = node.get("storage", 0, "TexMapping");
							n.buttons[0].default_value = storage.get("loc");
							n.buttons[1].default_value = storage.get("rot");
							n.buttons[2].default_value = storage.get("size");
							// let mat = storage.get("mat"); float[4][4]
							// storage.flag & 1 // use_min
							// storage.flag & 2 // use_max
							// storage.min[0]
							// storage.min[1]
							// storage.min[2]
							// storage.max[0]
							// storage.max[1]
							// storage.max[2]
						}

						// Fill output socket values
						let outputs = node.get("outputs");
						sock = outputs.get("first", 0, "bNodeSocket");
						pos = 0;
						while (true) {
							if (pos >= n.outputs.length) break;
							n.outputs[pos].default_value = ImportBlendMaterial.readBlendSocket(sock);

							let last = sock;
							sock = sock.get("next");
							if (last.block == sock.block) break;
							pos++;
						}

						canvas.nodes.push(n);
					}

					if (node.get("name") == last.get("name")) break;
					node = node.get("next");
				}

				// Place links
				let link: any = bllinks.get("first", 0, "bNodeLink");
				while (true) {
					let fromnode = link.get("fromnode").get("name");
					let tonode = link.get("tonode").get("name");
					let fromsock = link.get("fromsock");
					let tosock = link.get("tosock");

					let from_id = -1;
					let to_id = -1;
					for (let n of canvas.nodes) {
						if (n.name == fromnode) {
							from_id = n.id;
							break;
						}
					}
					for (let n of canvas.nodes) {
						if (n.name == tonode) {
							to_id = n.id;
							break;
						}
					}

					if (from_id >= 0 && to_id >= 0) {
						let from_socket = 0;
						let sock: any = fromsock;
						while (true) {
							let last = sock;
							sock = sock.get("prev");
							if (last.block == sock.block) break;
							from_socket++;
						}

						let to_socket = 0;
						sock = tosock;
						while (true) {
							let last = sock;
							sock = sock.get("prev");
							if (last.block == sock.block) break;
							to_socket++;
						}

						let valid = true;

						// Remap principled
						if (tonode == nout.name) {
							if (to_socket == 0) to_socket = 0; // Base
							else if (to_socket == 18) to_socket = 1; // Opac
							else if (to_socket == 7) to_socket = 3; // Rough
							else if (to_socket == 4) to_socket = 4; // Met
							else if (to_socket == 19) to_socket = 5; // TODO: auto-remove normal_map node
							else if (to_socket == 17) to_socket = 6; // Emis
							else if (to_socket == 1) to_socket = 8; // Subs
							else valid = false;
						}

						if (valid) {
							let raw: TNodeLink = {
								id: nodes.getLinkId(canvas.links),
								from_id: from_id,
								from_socket: from_socket,
								to_id: to_id,
								to_socket: to_socket
							};
							canvas.links.push(raw);
						}
					}

					let last = link;
					link = link.get("next");
					if (last.block == link.block) break;
				}
				History.newMaterial();
			}

			let _init = () => {
				for (let m of imported) {
					Context.setMaterial(m);
					MakeMaterial.parsePaintMaterial();
					UtilRender.makeMaterialPreview();
				}
			}
			App.notifyOnInit(_init);

			UIBase.hwnds[TabArea.TabSidebar1].redraws = 2;
			Data.deleteBlob(path);
		});
	}

	static readBlendSocket = (sock: any): any => {
		let idname = sock.get("idname");
		if (idname.startsWith("NodeSocketVector")) {
			let v: any = sock.get("default_value", 0, "bNodeSocketValueVector").get("value");
			v[0] = Math.floor(v[0] * 100) / 100;
			v[1] = Math.floor(v[1] * 100) / 100;
			v[2] = Math.floor(v[2] * 100) / 100;
			return v;
		}
		else if (idname.startsWith("NodeSocketColor")) {
			let v: any = sock.get("default_value", 0, "bNodeSocketValueRGBA").get("value");
			v[0] = Math.floor(v[0] * 100) / 100;
			v[1] = Math.floor(v[1] * 100) / 100;
			v[2] = Math.floor(v[2] * 100) / 100;
			v[3] = Math.floor(v[3] * 100) / 100;
			return v;
		}
		else if (idname.startsWith("NodeSocketFloat")) {
			let v: any = sock.get("default_value", 0, "bNodeSocketValueFloat").get("value");
			v = Math.floor(v * 100) / 100;
			return v;
		}
		else if (idname.startsWith("NodeSocketInt")) {
			return sock.get("default_value", 0, "bNodeSocketValueInt").get("value");
		}
		else if (idname.startsWith("NodeSocketBoolean")) {
			return sock.get("default_value", 0, "bNodeSocketValueBoolean").get("value");
		}
		else if (idname.startsWith("NodeSocketString")) {
			return sock.get("default_value", 0, "bNodeSocketValueString").get("value");
		}
		return null;
	}
}
