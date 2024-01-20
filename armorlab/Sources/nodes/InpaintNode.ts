
// @:keep
class InpaintNode extends LogicNode {

	static image: Image = null;
	static mask: Image = null;
	static result: Image = null;

	static temp: Image = null;
	static prompt = "";
	static strength = 0.5;
	static auto = true;

	constructor() {
		super();
		init();
	}

	static init = () => {
		if (image == null) {
			image = Image.createRenderTarget(Config.getTextureResX(), Config.getTextureResY());
		}

		if (mask == null) {
			mask = Image.createRenderTarget(Config.getTextureResX(), Config.getTextureResY(), TextureFormat.R8);
			Base.notifyOnNextFrame(() => {
				mask.g4.begin();
				mask.g4.clear(Color.fromFloats(1.0, 1.0, 1.0, 1.0));
				mask.g4.end();
			});
		}

		if (temp == null) {
			temp = Image.createRenderTarget(512, 512);
		}

		if (result == null) {
			result = Image.createRenderTarget(Config.getTextureResX(), Config.getTextureResY());
		}
	}

	static buttons = (ui: zui.Zui, nodes: zui.Zui.Nodes, node: zui.Zui.TNode) => {
		auto = node.buttons[0].default_value == 0 ? false : true;
		if (!auto) {
			strength = ui.slider(zui.Zui.handle("inpaintnode_0", {value: strength}), tr("strength"), 0, 1, true);
			prompt = ui.textArea(zui.Zui.handle("inpaintnode_1"), true, tr("prompt"), true);
			node.buttons[1].height = 1 + prompt.split("\n").length;
		}
		else node.buttons[1].height = 0;
	}

	override getAsImage = (from: i32, done: (img: Image)=>void) => {
		inputs[0].getAsImage((source: Image) => {

			Console.progress(tr("Processing") + " - " + tr("Inpaint"));
			Base.notifyOnNextFrame(() => {
				image.g2.begin(false);
				image.g2.drawScaledImage(source, 0, 0, Config.getTextureResX(), Config.getTextureResY());
				image.g2.end();

				auto ? texsynthInpaint(image, false, mask, done) : sdInpaint(image, mask, done);
			});
		});
	}

	override getCachedImage = (): Image => {
		Base.notifyOnNextFrame(() => {
			inputs[0].getAsImage((source: Image) => {
				if (Base.pipeCopy == null) Base.makePipe();
				if (ConstData.screenAlignedVB == null) ConstData.createScreenAlignedData();
				image.g4.begin();
				image.g4.setPipeline(Base.pipeInpaintPreview);
				image.g4.setTexture(Base.tex0InpaintPreview, source);
				image.g4.setTexture(Base.texaInpaintPreview, mask);
				image.g4.setVertexBuffer(ConstData.screenAlignedVB);
				image.g4.setIndexBuffer(ConstData.screenAlignedIB);
				image.g4.drawIndexedVertices();
				image.g4.end();
			});
		});
		return image;
	}

	getTarget = (): Image => {
		return mask;
	}

	static texsynthInpaint = (image: Image, tiling: bool, mask: Image/* = null*/, done: (img: Image)=>void) => {
		let w = arm.Config.getTextureResX();
		let h = arm.Config.getTextureResY();

		let bytes_img = image.getPixels();
		let bytes_mask = mask != null ? mask.getPixels() : new ArrayBuffer(w * h);
		let bytes_out = new ArrayBuffer(w * h * 4);
		Krom_texsynth.inpaint(w, h, bytes_out, bytes_img, bytes_mask, tiling);

		result = Image.fromBytes(bytes_out, w, h);
		done(result);
	}

	static sdInpaint = (image: Image, mask: Image, done: (img: Image)=>void) => {
		init();

		let bytes_img = mask.getPixels().b.buffer;
		let u8 = new Uint8Array(bytes_img);
		let f32mask = new Float32Array(4 * 64 * 64);

		Data.getBlob("models/sd_vae_encoder.quant.onnx", (vae_encoder_blob: ArrayBuffer) => {
			// for (let x = 0; x < Math.floor(image.width / 512); ++x) {
				// for (let y = 0; y < Math.floor(image.height / 512); ++y) {
					let x = 0;
					let y = 0;

					for (let xx = 0; xx < 64; ++xx) {
						for (let yy = 0; yy < 64; ++yy;) {
							// let step = Math.floor(512 / 64);
							// let j = (yy * step * mask.width + xx * step) + (y * 512 * mask.width + x * 512);
							let step = Math.floor(mask.width / 64);
							let j = (yy * step * mask.width + xx * step);
							let f = u8[j] / 255.0;
							let i = yy * 64 + xx;
							f32mask[i              ] = f;
							f32mask[i + 64 * 64    ] = f;
							f32mask[i + 64 * 64 * 2] = f;
							f32mask[i + 64 * 64 * 3] = f;
						}
					}

					temp.g2.begin(false);
					// temp.g2.drawImage(image, -x * 512, -y * 512);
					temp.g2.drawScaledImage(image, 0, 0, 512, 512);
					temp.g2.end();

					let bytes_img = temp.getPixels().b.buffer;
					let u8a = new Uint8Array(bytes_img);
					let f32a = new Float32Array(3 * 512 * 512);
					for (let i = 0; i < (512 * 512); ++i) {
						f32a[i                ] = (u8a[i * 4    ] / 255.0) * 2.0 - 1.0;
						f32a[i + 512 * 512    ] = (u8a[i * 4 + 1] / 255.0) * 2.0 - 1.0;
						f32a[i + 512 * 512 * 2] = (u8a[i * 4 + 2] / 255.0) * 2.0 - 1.0;
					}

					let latents_buf = Krom.mlInference(vae_encoder_blob, [f32a.buffer], [[1, 3, 512, 512]], [1, 4, 64, 64], Config.raw.gpu_inference);
					let latents = new Float32Array(latents_buf);
					for (let i = 0; i < latents.length; ++i) {
						latents[i] = 0.18215 * latents[i];
					}
					let latents_orig = latents.slice(0);

					let noise = new Float32Array(latents.length);
					for (let i = 0; i < noise.length; ++i) noise[i] = Math.cos(2.0 * 3.14 * RandomNode.getFloat()) * Math.sqrt(-2.0 * Math.log(RandomNode.getFloat()));

					let num_inference_steps = 50;
					let init_timestep = Math.floor(num_inference_steps * strength);
					let timestep = TextToPhotoNode.timesteps[num_inference_steps - init_timestep];
					let alphas_cumprod = TextToPhotoNode.alphas_cumprod;
					let sqrt_alpha_prod = Math.pow(alphas_cumprod[timestep], 0.5);
					let sqrt_one_minus_alpha_prod = Math.pow(1.0 - alphas_cumprod[timestep], 0.5);
					for (let i = 0; i < latents.length; ++i) {
						latents[i] = sqrt_alpha_prod * latents[i] + sqrt_one_minus_alpha_prod * noise[i];
					}

					let start = num_inference_steps - init_timestep;

					TextToPhotoNode.stableDiffusion(prompt, (img: Image) => {
						// result.g2.begin(false);
						// result.g2.drawImage(img, x * 512, y * 512);
						// result.g2.end();
						result = img;
						done(img);
					}, latents, start, true, f32mask, latents_orig);
				// }
			// }
		});
	}

	static def: zui.Zui.TNode = {
		id: 0,
		name: _tr("Inpaint"),
		type: "InpaintNode",
		x: 0,
		y: 0,
		color: 0xff4982a0,
		inputs: [
			{
				id: 0,
				node_id: 0,
				name: _tr("Color"),
				type: "RGBA",
				color: 0xffc7c729,
				default_value: new Float32Array([1.0, 1.0, 1.0, 1.0])
			}
		],
		outputs: [
			{
				id: 0,
				node_id: 0,
				name: _tr("Color"),
				type: "RGBA",
				color: 0xffc7c729,
				default_value: new Float32Array([0.0, 0.0, 0.0, 1.0])
			}
		],
		buttons: [
			{
				name: _tr("auto"),
				type: "BOOL",
				default_value: true,
				output: 0
			},
			{
				name: "arm.nodes.InpaintNode.buttons",
				type: "CUSTOM",
				height: 0
			}
		]
	};
}
