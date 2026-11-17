#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};



pair<ll ,ll> sai(const vector<map<ll, ll>>& g, vector<bool>& used, vector<ll>& root, ll l, ll len) {
	ll gaul = l;
	ll length = len;
	for (auto i : g[l]) {
		ll r = i.first;
		if (!used[r]) {
			used[r] = true;
			auto it = sai(g, used, root,  r, len + 1);
			if (it.second > length) {
				length = it.second;
				gaul = it.first;
			}
			root[r] = l;
		}
	}
	return {gaul, length};
}

ll wat(const vector<map<ll, ll>>& g, vector<bool>& used, vector<ll>& color, ll l, ll r, ll len) {
	queue<pair<ll, ll>> q;
	q.emplace(l, 0);
	used[r] = true;
	map<ll, ll> count1;
	map<ll, ll> count2;
	ll ans = 0;
	while (!q.empty()) {
		pair<ll, ll> p = q.front(); q.pop();
		used[p.first] = true;
		if (p.second == len) {
			count1[color[p.first]]++;
			continue;
		}
		for (auto i : g[p.first]) {
			if (!used[i.first]) {
				q.emplace(i.first, p.second + 1);
			}
		}
	}
	if (r == l) {
		for (auto i : count1) {
			ans += i.second * (i.second - 1) / 2;
		}
		return ans;
	}

	q.emplace(r, 0);
	while (!q.empty()) {
		pair<ll, ll> p = q.front(); q.pop();
		used[p.first] = true;
		if (p.second == len) {
			count2[color[p.first]]++;
			continue;
		}
		for (auto i : g[p.first]) {
			if (!used[i.first]) {
				q.emplace(i.first, p.second + 1);
			}
		}
	}
	for (auto i : count2) {
		ans += i.second * count1[i.first];
	}
	return ans;
}

ll solve() {
	ll n; cin >> n;
	vector<pair<ll, ll>> a(n);
	vector<map<ll, ll>> g(n);
	vector<bool> used(n, false);
	vector<bool> used1(n, false);
	for (ll i = 0; i < n - 1; i++) {
		ll x, y; cin >> x >> y;
		a[i] = {--x, --y};
		g[x][y] = 1;
		g[y][x] = 1;
	}
	vector<ll> c(n);
	for (ll i = 0; i < n; i++) {
		cin >> c[i];
	}
	vector<ll> root(n);
	auto aa = sai(g, used, root, 0, 0);
	aa = sai(g, used1, root, aa.first, 0);
	ll ans = 0;
	if (aa.second % 2 == 0) {
		ll l = aa.first;
		for (ll i = 0; i < aa.second / 2; i++) {
			l = root[l];
		}
		vector<bool> used2(n, false);
		ans = wat(g, used2, c, l, l, aa.second / 2);
	} else {
		ll l = aa.first;
		for (ll i = 0; i < aa.second / 2; i++) {
			l = root[l];
		}
		vector<bool> used2(n, false);
		ans = wat(g, used2, c, l, root[l],  aa.second / 2);
	}
	cout << ans << endl;
	return 0;
}

int main() {
	std::ios::sync_with_stdio(false);
	std::cin.tie(nullptr);

	solve();
    return 0;
}

