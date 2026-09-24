// canvas sparkline — dpr aware, skips zero-size canvases

/* canvas cannot read CSS variables; these match --up and --down in app.css */
export const UP = '#00fdff';
export const DOWN = '#fc1951';
export function trendColor(delta: number): string {
	return delta >= 0 ? UP : DOWN;
}

export interface SparkParams {
	data: number[];
	color: string;
	fill?: boolean;
	tail?: boolean;
}

export function sparkline(node: HTMLCanvasElement, params: SparkParams) {
	function draw({ data, color, fill = true, tail = false }: SparkParams) {
		const dpr = window.devicePixelRatio || 1;
		const w = node.clientWidth;
		const h = node.clientHeight;
		if (!w || !h || data.length < 2) return;
		const bw = Math.round(w * dpr);
		const bh = Math.round(h * dpr);
		if (node.width !== bw || node.height !== bh) {
			node.width = bw;
			node.height = bh;
		}
		const g = node.getContext('2d');
		if (!g) return;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		let min = Infinity;
		let max = -Infinity;
		for (const v of data) {
			if (v < min) min = v;
			if (v > max) max = v;
		}
		if (max - min < 1e-12) max = min + 1e-12;
		const px = (i: number) => (i / (data.length - 1)) * w;
		const py = (v: number) => h - 2 - ((v - min) / (max - min)) * (h - 5);
		g.beginPath();
		data.forEach((v, i) => (i ? g.lineTo(px(i), py(v)) : g.moveTo(px(i), py(v))));
		g.strokeStyle = color;
		g.lineWidth = tail ? 1.35 : 1.5;
		g.lineJoin = 'round';
		g.lineCap = 'round';
		g.stroke();
		if (tail) {
			const layer = document.createElement('canvas');
			layer.width = bw;
			layer.height = bh;
			const lg = layer.getContext('2d');
			if (lg) {
				lg.setTransform(dpr, 0, 0, dpr, 0, 0);
				lg.beginPath();
				data.forEach((v, i) => (i ? lg.lineTo(px(i), py(v)) : lg.moveTo(px(i), py(v))));
				lg.lineTo(w, h);
				lg.lineTo(0, h);
				lg.closePath();
				const across = lg.createLinearGradient(0, 0, w, 0);
				across.addColorStop(0, color + '00');
				across.addColorStop(0.45, color + '0c');
				across.addColorStop(1, color + '2e');
				lg.fillStyle = across;
				lg.fill();
				lg.globalCompositeOperation = 'destination-in';
				const down = lg.createLinearGradient(0, 0, 0, h);
				down.addColorStop(0, 'rgba(0,0,0,0)');
				down.addColorStop(0.22, 'rgba(0,0,0,0.9)');
				down.addColorStop(0.7, 'rgba(0,0,0,0.28)');
				down.addColorStop(1, 'rgba(0,0,0,0)');
				lg.fillStyle = down;
				lg.fillRect(0, 0, w, h);
				g.drawImage(layer, 0, 0, w, h);
			}
		} else if (fill) {
			g.lineTo(w, h);
			g.lineTo(0, h);
			g.closePath();
			const gr = g.createLinearGradient(0, 0, 0, h);
			gr.addColorStop(0, color + '38');
			gr.addColorStop(0.45, color + '10');
			gr.addColorStop(1, color + '00');
			g.fillStyle = gr;
			g.fill();
		}
	}
	draw(params);
	return {
		update(p: SparkParams) {
			draw(p);
		}
	};
}
