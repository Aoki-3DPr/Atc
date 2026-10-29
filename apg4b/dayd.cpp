#include <iostream>
#include <vector>
#include <chrono>
#include <numeric>

using namespace std;

struct UnionFind {
	vector<int> parent;
	vector<int> rank;
	bool use_optimization;

	UnionFind(int n, bool opt) : parent(n), rank(n, 0), use_optimization(opt) {
		iota(parent.begin(), parent.end(), 0);
	}

	int find(int x) {
		if (parent[x] == x) return x;
		if (use_optimization) {
			return parent[x] = find(parent[x]); // Path Compression
		} else {
			return find(parent[x]); // No Path Compression
		}
	}

	void unite(int x, int y) {
		int rootX = find(x);
		int rootY = find(y);
		if (rootX != rootY) {
			if (use_optimization) {
				// Union by Rank
				if (rank[rootX] < rank[rootY]) {
					parent[rootX] = rootY;
				} else {
					parent[rootY] = rootX;
					if (rank[rootX] == rank[rootY]) rank[rootX]++;
				}
			} else {
				// Skewed tree generation
				parent[rootX] = rootY;
			}
		}
	}
};

void benchmark(int n, bool optimized) {
	UnionFind uf(n, optimized);
	auto start = chrono::high_resolution_clock::now();

	// Worst-case structure: 0->1->2->3...->N
	for (int i = 0; i < n - 1; ++i) {
		uf.unite(i, i + 1);
	}

	// Heavy find operations
	for (int i = 0; i < min(n, 5000); ++i) {
		uf.find(0);
	}

	auto end = chrono::high_resolution_clock::now();
	chrono::duration<double> diff = end - start;

	cout << (optimized ? "[Optimized]   " : "[Unoptimized] ")
		 << "Time: " << diff.count() << " s" << endl;
}

int main() {
	const int N = 20000; // Small N to avoid Stack Overflow in Unoptimized mode

	cout << "N = " << N << endl;
	benchmark(N, false);
	benchmark(N, true);

	return 0;
}