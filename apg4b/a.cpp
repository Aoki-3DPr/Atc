#include <bits/stdc++.h>
#define ll long long
using namespace std;
ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll MOD = 998244353;

vector<ll> fact_inv, inv;
/*  init_nCk :二項係数のための前処理
	計算量:O(k)
*/
void init_nCk(int SIZE) {
	fact_inv.resize(SIZE + 5);
	inv.resize(SIZE + 5);
	fact_inv[0] = fact_inv[1] = 1;
	inv[1] = 1;
	for (int i = 2; i < SIZE + 5; i++) {
		inv[i] = MOD - inv[MOD % i] * (MOD / i) % MOD;
		fact_inv[i] = fact_inv[i - 1] * inv[i] % MOD;
	}
}
/* nCk :MODでの二項係数を求める(前処理 int_nCk が必要) */
ll nCk(ll n, ll k) {
	if (n < k || n < 0 || k < 0) return 0; // 安全対策
	ll ans = 1;
	for (ll i = n; i >= n - k + 1; i--) {
		// i が非常に大きい場合、そのまま掛けると long long でも
		// オーバーフローするため、必ず (i % MOD) を掛ける
		ans *= (i % MOD);
		ans %= MOD;
	}
	return ans * fact_inv[k] % MOD;
}

vector<ll> topological_sort(vector<vector<ll>>& G, vector<ll>& indegree, ll V) {
	// トポロジカルソートを記録する配列
	vector<ll> sorted_vertices;

	// 入次数が0の頂点を発見したら、処理待ち頂点としてキューに追加する
	queue<ll> que;
	for (int i = 0; i < V; i++) {
		if (indegree[i] == 0) {
			que.push(i);
		}
	}

	while (que.empty() == false) {
		// キューの先頭の頂点を取り出す
		ll v = que.front();
		que.pop();

		for (int u : G[v]) {
				indegree[u] -= 1;
			if (indegree[u] == 0)
				que.push(u);
		}
		// 頂点vを配列の末尾に追加する
		sorted_vertices.push_back(v);
	}

	// トポロジカルソートを返す
	return sorted_vertices;
}



int solve() {
	ll n; cin >> n;
	vector<vector<ll>> G(n);
	G[0].push_back(0);
	vector<ll> indegree(n);
	for (ll i = 1; i < n; i++) {
		ll x; cin >> x;
		x--;
		indegree[x]++;
		G[i].push_back(x);
	}
	vector<ll> c;
	for (ll i = 0; i < n; i++) {
		ll x; cin >> x;
		c.push_back(x);
	}
	vector<ll> d;
	for (ll i = 0; i < n; i++) {
		ll x; cin >> x;
		d.push_back(x);
	}
	ll ans = 1;
	init_nCk(1e7);
	vector<ll> to = topological_sort(G, indegree, n);
	for (ll i = 0; i < n; i++) {
		ll x = to[i];
		if (c[x] < d[x]) {
			ans = 0;
			break;
		}
		ans = ans * nCk(c[x], d[x]) % MOD;
		c[G[x][0]] += c[x] - d[x];
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
	return 0;
}
