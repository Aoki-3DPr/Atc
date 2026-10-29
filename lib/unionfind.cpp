#pragma once
#include <chrono>
#include <iostream>
#include <numeric>
#include <vector>
using namespace std;

class UnionFind {
private:
	vector<int> v;
	vector<int> r;
	vector<int> w;
	static void s(vector<int>& v) {
		for (int i = 0; i < v.size(); i++) {
			v[i] = i;
		}
	}

public:
	UnionFind(int size) {
		this->v.resize(size);
		this->r.resize(size);
		this->w.resize(size, 1);
		s(this->v);
	}

	int find(int p) {
		if (this->v[p] == p) {
			return p;
		} else {
			v[p] = find(v[p]);
			return v[p];
		}
	}

	void unite(int x, int y) {
		int X = find(x);
		int Y = find(y);
		if (X == Y) {
			return;
		}
		if (r[X] > r[Y]) {
			v[Y] = X;
			w[X] += w[Y];
		} else if (r[Y] > r[X]) {
			v[X] = Y;
			w[X] += w[Y];
		} else {
			v[Y] = X;
			w[X] += w[Y];
			r[X]++;
		}
	}
};


#ifdef BUILDING_LIB_STANDALONE
int main() {
	int n, q;
	cin >> n;
	cin >> q;
	UnionFind uf(n);
	while (q--) {
		int a;
		cin >> a;
		if (a == 0) {
			int x, y;
			cin >> x >> y;
			uf.unite(x, y);
		} else {
			int x, y;
			cin >> x >> y;
			cout << (uf.find(x) == uf.find(y)) << endl;
		}
	}
	return 0;
}
#endif
