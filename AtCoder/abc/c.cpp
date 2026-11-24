#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> v(n);
	map<ll, ll> mp;
	for (ll i = 0; i < n; i++) {
		cin >> v[i];
		mp[v[i]]++;
	}
	priority_queue<pair<ll, ll>> p;
	for (auto i : mp) {
		if (i.second < 2) continue;
		p.emplace(i);
	}
	if (p.size() < 2) {
		cout << 0 << endl;
		return 0;
	}
	auto fi = p.top(); p.pop();
	auto se = p.top();
	if (fi.second >= 4) {
		cout << fi.first * fi.first << endl;
	} else {
		cout << fi.first * se.first << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

