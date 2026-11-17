#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll k; cin >> k;
	vector<ll> v;
	for (ll i = 0; i < k; i ++) {
		ll x; cin >> x;
		v.push_back(x);
	}
	sort(v.begin(), v.end());
	if (v[v.size() - 1] != 9) {
		cout << -1 << endl;
	} else {
		cout << v[0] << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

