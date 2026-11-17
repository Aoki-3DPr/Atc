#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> a(n);
	vector<ll> b(n);
	for (ll i = 0; i < n; i++) {
		cin >> a[i];
	}
	ll left = -1;
	ll right = -1;
	for (ll i = 0; i < n; i++) {
		cin >> b[i];
		if (a[i] != b[i]) {
			if (left == -1) left = i;
			right = i;
		}
	}
	if (left == -1) {
		cout << "Yes" << endl;
		return 0;
	}
	ll len = right - left + 1;
	bool flag = true;
	for (ll i = left; i < left + len; i++) {
		if (a[i == left + len - 1 ? left : i + 1] != b[i]) {
			flag = false;
			break;
		}

	}
	bool flag2 = true;
	for (ll i = left; i < left + len; i++) {
		if (a[i == left ? left + len - 1 : i - 1] != b[i]) {
			flag2 = false;
			break;
		}
	}
	if (flag || flag2) {
		cout << "Yes" << endl;
	} else {
		cout << "No" << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

