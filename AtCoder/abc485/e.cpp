#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, m;
	cin >> n >> m;
	vector<unordered_map<ll, set<ll>>> gg(n);
	vector<unordered_map<ll, set<ll>>> g(n);
	for (ll i = 0; i < m; i++) {
		ll x, y, z;
		cin >> x >> y >> z;
		g[--x][--y].insert(z);
		gg[x][y].insert(z);
	}
	vector<unordered_map<ll, ll>> color(n);
	vector<ll> c_count(n);
	vector<ll> ans(n, INT_MAX);
	queue<pair<ll, pair<ll,ll>>> q;
	ans[0] = 0;
	ll a = INT_MAX;
	q.push({0, {-1, 0}});
	while (!q.empty()) {
		auto p = q.front();
		q.pop();
		ll l = p.first;
		ll old_c = p.second.first;
		ll old_cs = p.second.second;
		for (const auto& i : g[l]) {
			ll r = i.first;
			for (auto j : i.second) {
				if (c_count[r] >= 2) {
					break;
				}
				if (!color[r].contains(j) && old_c != j) {

					color[r][j]++;
					c_count[r]++;
					q.push({r, {j, old_cs + 1}});

					if (r == n - 1) {
						a = min(a, old_cs + 1);
						cout << a ;
						return 0;
					}
				}
			}
		}
	}
	if (a == INT_MAX) {
		cout << -1 ;
		return 0;
	}
	cout << a << endl;
	return 0;
}

int main() {
	solve();
	return 0;
}
