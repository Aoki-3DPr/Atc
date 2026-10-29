#include <bits/stdc++.h>
#define ll long long
using namespace std;
int di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
int dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll MOD = 998244353;

vector<ll> fact_inv, inv, fact;
/*  init_nCk :二項係数のための前処理
	計算量:O(k)
*/
void init_nCk(int SIZE) {
	fact_inv.resize(SIZE + 5);
	inv.resize(SIZE + 5);
	fact.resize(SIZE + 5);
	fact_inv[0] = fact_inv[1] = 1;
	inv[1] = 1;
	fact[0] = fact[1] = 1;
	for (int i = 2; i < SIZE + 5; i++) {
		fact[i] = fact[i - 1] * i % MOD;
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

/* nCk :MODでの二項係数を求める(前処理 int_nCk が必要) */
ll nCk1(ll n, ll k) {
	if (n < k || n < 0 || k < 0) return 0; // 安全対策
	ll ans = fact[n] * fact_inv[n - k] % MOD;
	return ans * fact_inv[k] % MOD;
}

ll solve() {
	ll n, k; cin >> n >> k;
	init_nCk(10e5);
	vector<ll> v(n);
	ll sum = 0;
	ll sum2 = 0;
	for (int i = 0; i < n; i++) {
		cin >> v[i];
		sum += v[i];
		sum %= MOD;
		sum2 += v[i] * v[i];
		sum2 %= MOD;
	}
	if (k == 1) {
		cout << sum2 << endl;
		return 0;
	}
	sum2 = nCk1(n - 1, k - 1) * sum2 % MOD;
	if (k == 2) {
		ll buf = 0;
		for (int i = 0; i < n; i++) {
			buf += (sum - v[i]) * v[i] * 2 % MOD;
			buf /= n - 1;
		}
		sum2 = (sum2 + buf) % MOD;

	}
	return 0;
}

int main() {
	solve();
	return 0;
}
